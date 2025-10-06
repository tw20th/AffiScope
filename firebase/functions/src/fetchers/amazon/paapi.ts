// firebase/functions/src/fetchers/amazon/paapi.ts
import paapi5sdk from "paapi5-nodejs-sdk";
import { withRetry } from "../../lib/retry.js";

export type AmazonOffer = {
  price?: number;
  url?: string;
  title?: string;
  brand?: string;
  imageUrl?: string;

  // specs に渡す素材
  features?: string[];
  dimensions?: {
    height?: { value: number; unit: string };
    length?: { value: number; unit: string };
    width?: { value: number; unit: string };
    weight?: { value: number; unit: string };
  };
  material?: string;
  warranty?: string;
  merchant?: string;
  offerCount?: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function get<T>(obj: unknown, path: (string | number)[]): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    const k = typeof key === "number" ? key : String(key);
    if (!((k in cur) as any)) return undefined;
    cur = (cur as any)[k];
  }
  return cur as T;
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function isValidAsin(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}

// ---- 表示用に短い材質ラベルへ圧縮
function toShortMaterial(s?: string): string | undefined {
  if (!s) return undefined;
  const hits = new Set<string>();
  if (/メッシュ|mesh/i.test(s)) hits.add("メッシュ");
  if (/PU|ポリウレタン|合成皮革|synthetic.*leather|pu leather/i.test(s))
    hits.add("PUレザー");
  if (/ファブリック|布|クロス|fabric/i.test(s)) hits.add("ファブリック");
  if (/ポリプロピレン|pp\b|polypropylene/i.test(s)) hits.add("ポリプロピレン");
  if (/本革|牛革|genuine.*leather/i.test(s)) hits.add("本革");
  return hits.size ? Array.from(hits).join(" / ") : undefined;
}

function normalizeFeatures(
  src?: string[],
  title?: string
): string[] | undefined {
  const text = [...(src || []), title || ""].join(" / ");
  const rules: [RegExp, string][] = [
    [/ランバー|腰(サポート)?/i, "ランバーサポート"],
    [/リクライニング|180度|135度/i, "リクライニング"],
    [/ヘッドレスト|枕|ピロー/i, "ヘッドレスト"],
    [/アームレスト|肘掛け|肘置き/i, "アームレスト"],
    [/オットマン|フットレスト/i, "オットマン"],
    [/ロッキング|シンクロ/i, "ロッキング"],
    [/昇降|高さ調節|ガス(昇降)?/i, "座面昇降"],
    [/ハイバック/i, "ハイバック"],
    [/通気性|メッシュ/i, "通気性"],
  ];
  const out = new Set<string>();
  for (const [re, label] of rules) if (re.test(text)) out.add(label);
  const arr = Array.from(out);
  return arr.length ? arr.slice(0, 8) : undefined;
}

const toCm = (val?: number, unit?: string): number | undefined => {
  if (typeof val !== "number" || !isFinite(val)) return undefined;
  if (!unit) return val;
  if (/inch|inches|^in$/i.test(unit)) return +(val * 2.54).toFixed(1);
  if (/millimeters?|^mm$/i.test(unit)) return +(val / 10).toFixed(1);
  return val; // 既に cm 想定
};
const toKg = (val?: number, unit?: string): number | undefined => {
  if (typeof val !== "number" || !isFinite(val)) return undefined;
  if (!unit) return val;
  if (/pounds?|^lb$/i.test(unit)) return +(val * 0.453592).toFixed(2);
  if (/grams?|^g$/i.test(unit)) return +(val / 1000).toFixed(2);
  return val; // 既に kg 想定
};

// ---- GetItems 用リソース（安全側に多め）
const FULL_RESOURCES = [
  "ItemInfo.Title",
  "ItemInfo.ByLineInfo",
  "ItemInfo.Features",
  "ItemInfo.ProductInfo",
  "ItemInfo.ManufactureInfo",
  "Images.Primary.Large",
  "DetailPageURL",
  "Offers.Listings.Price",
  "Offers.Listings.MerchantInfo",
  "Offers.Summaries.LowestPrice",
  "Offers.OfferCount",
] as const;

const MIN_RESOURCES = [
  "ItemInfo.Title",
  "Offers.Listings.Price",
  "DetailPageURL",
] as const;

export async function fetchAmazonOffers(
  asins: string[],
  opts?: { partnerTag?: string }
): Promise<Record<string, AmazonOffer | null>> {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const PARTNER_TAG = opts?.partnerTag || process.env.AMAZON_PARTNER_TAG;

  const empty = Object.fromEntries(asins.map((a) => [a, null])) as Record<
    string,
    AmazonOffer | null
  >;

  if (!ACCESS_KEY || !SECRET_KEY || !PARTNER_TAG) {
    console.error("[PAAPI] Missing credentials.", {
      hasAK: !!ACCESS_KEY,
      hasSK: !!SECRET_KEY,
      hasPT: !!PARTNER_TAG,
    });
    return empty;
  }

  // 署名干渉の予防
  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;
  delete (process.env as any).AMAZON_REGION;

  const Paapi: any = paapi5sdk;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.host = "webservices.amazon.co.jp";
  client.region = "us-west-2";

  const api = new Paapi.DefaultApi();

  async function callOnce(_asins: string[], minimal = false) {
    const req = new Paapi.GetItemsRequest();
    req["PartnerTag"] = PARTNER_TAG;
    req["PartnerType"] = "Associates";
    req["ItemIds"] = _asins;
    req["Resources"] = minimal ? [...MIN_RESOURCES] : [...FULL_RESOURCES];

    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          api.getItems(req, (error: any, result: any) =>
            error ? reject(error) : resolve(result)
          );
        }),
      3
    );
  }

  const valid = asins.filter(isValidAsin);
  const invalid = asins.filter((a) => !isValidAsin(a));
  if (invalid.length)
    console.warn("[PAAPI] Skip invalid ASIN(s):", invalid.join(","));

  const batches = chunk(valid, 10);
  const out: Record<string, AmazonOffer | null> = { ...empty };

  for (const group of batches) {
    if (!group.length) continue;

    let data: any;
    try {
      data = await callOnce(group, false);
    } catch (e1: any) {
      try {
        console.warn(
          "[PAAPI] fallback to MIN_RESOURCES:",
          e1?.status || e1?.code || ""
        );
        data = await callOnce(group, true);
      } catch (e2: any) {
        console.error("[PAAPI] getItems FAILED", e2?.status || e2?.code || "", {
          group,
        });
        for (const a of group) out[a] = null;
        continue;
      }
    }

    const items = get<unknown[]>(data, ["ItemsResult", "Items"]) ?? [];

    for (const it of items) {
      if (!isRecord(it)) continue;
      const asin = get<string>(it, ["ASIN"]);
      if (!asin) continue;

      // 基本
      const title = get<string>(it, ["ItemInfo", "Title", "DisplayValue"]);
      const brand =
        get<string>(it, ["ItemInfo", "ByLineInfo", "Brand", "DisplayValue"]) ||
        get<string>(it, [
          "ItemInfo",
          "ByLineInfo",
          "Manufacturer",
          "DisplayValue",
        ]);
      const price =
        get<number>(it, ["Offers", "Listings", 0, "Price", "Amount"]) ??
        get<number>(it, ["Offers", "Summaries", 0, "LowestPrice", "Amount"]);
      const url = get<string>(it, ["DetailPageURL"]);
      const imageUrl = get<string>(it, ["Images", "Primary", "Large", "URL"]);

      // specs 素材
      const featuresRaw =
        get<string[]>(it, ["ItemInfo", "Features", "DisplayValues"]) ||
        get<string[]>(it, ["ItemInfo", "Features"]);
      const productInfo = get<any>(it, ["ItemInfo", "ProductInfo"]);
      const manuInfo = get<any>(it, ["ItemInfo", "ManufactureInfo"]);
      const merchant = get<string>(it, [
        "Offers",
        "Listings",
        0,
        "MerchantInfo",
        "Name",
      ]);
      const offerCount =
        get<number>(it, ["Offers", "OfferCount"]) ??
        get<number>(it, ["Offers", "Summaries", 0, "OfferCount"]);

      // 寸法: ItemDimensions → PackageDimensions（ProductInfo or ManufactureInfo）をフォールバック
      const idims =
        productInfo?.ItemDimensions ||
        productInfo?.PackageDimensions ||
        get<any>(it, ["ItemInfo", "ManufactureInfo", "PackageDimensions"]);

      const dim = (axis: "Height" | "Length" | "Width" | "Weight") => {
        const node = idims && idims[axis];
        const v =
          get<number>(node, ["DisplayValue"]) ?? get<number>(node, ["value"]);
        const u = get<string>(node, ["Unit"]) ?? get<string>(node, ["unit"]);
        if (typeof v !== "number") return undefined;
        if (axis === "Weight") {
          const kg = toKg(v, u);
          return kg !== undefined ? { value: kg, unit: "kg" } : undefined;
        }
        const cm = toCm(v, u);
        return cm !== undefined ? { value: cm, unit: "cm" } : undefined;
      };

      let dimensions: AmazonOffer["dimensions"] | undefined;
      if (idims) {
        dimensions = {
          height: dim("Height"),
          length: dim("Length"),
          width: dim("Width"),
          weight: dim("Weight"),
        };
        if (
          !dimensions.height &&
          !dimensions.length &&
          !dimensions.width &&
          !dimensions.weight
        ) {
          dimensions = undefined;
        }
      }

      // 保証
      let warranty: string | undefined;
      const wraw = get<any>(manuInfo, ["Warranty"]);
      if (typeof wraw === "string") warranty = wraw;
      else if (isRecord(wraw) && typeof (wraw as any).DisplayValue === "string")
        warranty = (wraw as any).DisplayValue;
      else if (Array.isArray(wraw))
        warranty = wraw.filter((s) => typeof s === "string").join(" / ");
      if (!warranty && typeof title === "string") {
        const m = title.match(/(\d+)\s*年保証/);
        if (m) warranty = `${m[1]}年保証`;
      }

      // 材質
      let material: string | undefined;
      const materialNode =
        get<any>(productInfo, ["Material"]) ||
        get<any>(productInfo, ["Material", "DisplayValue"]);
      if (typeof materialNode === "string")
        material = toShortMaterial(materialNode);
      else if (
        isRecord(materialNode) &&
        typeof (materialNode as any).DisplayValue === "string"
      )
        material = toShortMaterial((materialNode as any).DisplayValue);
      else if (Array.isArray(materialNode))
        material = toShortMaterial(
          materialNode.filter((s) => typeof s === "string").join(" / ")
        );
      if (!material)
        material = toShortMaterial(
          [...(featuresRaw || []), title || ""].filter(Boolean).join(" / ")
        );

      const features = normalizeFeatures(featuresRaw, title);

      out[asin] = {
        price,
        url,
        title,
        brand,
        imageUrl,
        features,
        dimensions,
        material,
        warranty,
        merchant,
        offerCount,
      };
    }
  }

  return out;
}
