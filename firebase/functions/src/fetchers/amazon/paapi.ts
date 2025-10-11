// firebase/functions/src/fetchers/amazon/paapi.ts
import paapi5sdk from "paapi5-nodejs-sdk";
import { withRetry } from "../../lib/retry.js";

export type AmazonOffer = {
  price?: number;
  url?: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  // specs 向け素材
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

type Marketplace = "JP" | "US" | "UK" | "DE" | "FR" | "CA" | "IT" | "ES" | "IN";
type AmazonAffiliate = { partnerTag?: string; marketplace?: Marketplace };

const ENDPOINTS: Record<Marketplace, { host: string; region: string }> = {
  JP: { host: "webservices.amazon.co.jp", region: "us-west-2" },
  US: { host: "webservices.amazon.com", region: "us-east-1" },
  UK: { host: "webservices.amazon.co.uk", region: "eu-west-1" },
  DE: { host: "webservices.amazon.de", region: "eu-west-1" },
  FR: { host: "webservices.amazon.fr", region: "eu-west-1" },
  IT: { host: "webservices.amazon.it", region: "eu-west-1" },
  ES: { host: "webservices.amazon.es", region: "eu-west-1" },
  CA: { host: "webservices.amazon.ca", region: "us-east-1" },
  IN: { host: "webservices.amazon.in", region: "eu-west-1" },
};

const MARKETPLACE_DOMAINS: Record<Marketplace, string> = {
  JP: "www.amazon.co.jp",
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
  FR: "www.amazon.fr",
  IT: "www.amazon.it",
  ES: "www.amazon.es",
  CA: "www.amazon.ca",
  IN: "www.amazon.in",
};

// ---------- utils ----------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function get<T>(obj: unknown, path: (string | number)[]): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    const rec = cur as Record<string, unknown>;
    const k = typeof key === "number" ? key : String(key);
    if (!(k in rec)) return undefined;
    cur = rec[k as keyof typeof rec];
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 表示用材質ラベル圧縮（椅子ルール流用）
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
  return val; // 既に cm
};
const toKg = (val?: number, unit?: string): number | undefined => {
  if (typeof val !== "number" || !isFinite(val)) return undefined;
  if (!unit) return val;
  if (/pounds?|^lb$/i.test(unit)) return +(val * 0.453592).toFixed(2);
  if (/grams?|^g$/i.test(unit)) return +(val / 1000).toFixed(2);
  return val; // 既に kg
};

// ---- Resources（段階的フォールバック）
const FULL_RESOURCES = [
  "ItemInfo.Title",
  "ItemInfo.Features",
  "Images.Primary.Large",
  "Offers.Summaries.LowestPrice",
  "Offers.Summaries.OfferCount", // ← PA-API v5 は Summaries 側
  "Offers.Listings.MerchantInfo",
] as const;

const MIN_RESOURCES = ["ItemInfo.Title", "Images.Primary.Large"] as const;
const ULTRA_MIN_RESOURCES = ["ItemInfo.Title"] as const;

// ---- クライアント初期化（marketplace/partnerTag を統一管理）
function createClient(aff?: AmazonAffiliate) {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const FALLBACK_PARTNER = process.env.AMAZON_PARTNER_TAG;

  const partnerTag = aff?.partnerTag || FALLBACK_PARTNER;
  const marketplace: Marketplace = aff?.marketplace || "JP";

  if (!ACCESS_KEY || !SECRET_KEY || !partnerTag) {
    throw new Error(
      `[PAAPI] Missing creds. hasAK=${!!ACCESS_KEY} hasSK=${!!SECRET_KEY} hasPT=${!!partnerTag}`
    );
  }

  // 署名に影響する環境変数の干渉を避ける
  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;
  delete (process.env as any).AMAZON_REGION;

  const ep = ENDPOINTS[marketplace];
  if (!ep) throw new Error(`Unsupported marketplace: ${marketplace}`);

  const Paapi: any = paapi5sdk;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.host = ep.host;
  client.region = ep.region;

  const api = new Paapi.DefaultApi();
  return { api, partnerTag, marketplace };
}

// ---- Public: GetItems を叩いて Offer 情報を作る
export async function fetchAmazonOffers(
  asins: string[],
  aff?: AmazonAffiliate
): Promise<Record<string, AmazonOffer | null>> {
  const empty = Object.fromEntries(asins.map((a) => [a, null])) as Record<
    string,
    AmazonOffer | null
  >;

  const valid = asins.filter(isValidAsin);
  const invalid = asins.filter((a) => !isValidAsin(a));
  if (invalid.length)
    console.warn("[PAAPI] Skip invalid ASIN:", invalid.join(","));

  let apiObj: ReturnType<typeof createClient>;
  try {
    apiObj = createClient(aff);
  } catch (e) {
    console.error(e);
    return empty;
  }
  const { api, partnerTag, marketplace } = apiObj;

  async function callOnce(group: string[], level: "FULL" | "MIN" | "ULTRA") {
    const req = new (paapi5sdk as any).GetItemsRequest();
    req["PartnerTag"] = partnerTag;
    req["PartnerType"] = "Associates";
    req["ItemIds"] = group;
    req["Marketplace"] = MARKETPLACE_DOMAINS[marketplace];

    const reslist =
      level === "FULL"
        ? [...FULL_RESOURCES]
        : level === "MIN"
        ? [...MIN_RESOURCES]
        : [...ULTRA_MIN_RESOURCES];
    req["Resources"] = reslist;

    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          api.getItems(req, (error: any, result: any) => {
            if (error) {
              const status =
                error?.status ?? error?.response?.status ?? error?.code ?? "";
              const body =
                error?.response?.data ??
                error?.response?.text ??
                error?.message ??
                String(error);
              console.error("[PAAPI:getItems] error", {
                status,
                body,
                group,
                reslist,
              });
              reject(error);
            } else {
              resolve(result);
            }
          });
        }),
      1
    );
  }

  // バッチは小さめ（429 緩和）
  const batches = chunk(valid, 5);
  const out: Record<string, AmazonOffer | null> = { ...empty };

  for (const group of batches) {
    if (!group.length) continue;

    let data: any;
    try {
      data = await callOnce(group, "FULL");
    } catch (e1: any) {
      try {
        console.warn("[PAAPI] fallback MIN_RESOURCES");
        data = await callOnce(group, "MIN");
      } catch (e2: any) {
        try {
          console.warn("[PAAPI] fallback ULTRA_MIN_RESOURCES");
          data = await callOnce(group, "ULTRA");
        } catch (e3: any) {
          const status = e3?.status ?? e3?.response?.status ?? e3?.code ?? "";
          const body =
            e3?.response?.data ??
            e3?.response?.text ??
            e3?.message ??
            String(e3);
          console.error("[PAAPI] getItems FAILED", status, { group, body });
          for (const a of group) out[a] = null;
          await sleep(1600);
          continue;
        }
      }
    }

    // レスポンス内のエラー・無効ASIN表示（デバッグ用）
    const respErrors = get<any[]>(data, ["Errors"]) ?? [];
    if (respErrors.length)
      console.warn("[PAAPI:getItems] response.Errors:", respErrors);
    const invalidAsins =
      get<any[]>(data, ["ItemsResult", "InvalidASINs"]) ?? [];
    if (invalidAsins.length)
      console.warn("[PAAPI:getItems] InvalidASINs:", invalidAsins);

    const items = get<unknown[]>(data, ["ItemsResult", "Items"]) ?? [];
    for (const it of items) {
      if (!isRecord(it)) continue;
      const asin = get<string>(it, ["ASIN"]);
      if (!asin) continue;

      const title = get<string>(it, ["ItemInfo", "Title", "DisplayValue"]);
      const brand =
        get<string>(it, ["ItemInfo", "ByLineInfo", "Brand", "DisplayValue"]) ||
        get<string>(it, [
          "ItemInfo",
          "ByLineInfo",
          "Manufacturer",
          "DisplayValue",
        ]);

      // 価格は Summaries を優先
      const price =
        get<number>(it, ["Offers", "Summaries", 0, "LowestPrice", "Amount"]) ??
        get<number>(it, ["Offers", "Listings", 0, "Price", "Amount"]);

      const url = get<string>(it, ["DetailPageURL"]);
      const imageUrl = get<string>(it, ["Images", "Primary", "Large", "URL"]);

      const featuresRaw =
        get<string[]>(it, ["ItemInfo", "Features", "DisplayValues"]) ||
        get<string[]>(it, ["ItemInfo", "Features"]);
      const productInfo = get<any>(it, ["ItemInfo", "ProductInfo"]);
      const manuInfo = get<any>(it, ["ItemInfo", "ManufactureInfo"]);

      // 出品数は Summaries 側
      const offerCount = get<number>(it, [
        "Offers",
        "Summaries",
        0,
        "OfferCount",
      ]);

      // 販売元名
      const merchant = get<string>(it, [
        "Offers",
        "Listings",
        0,
        "MerchantInfo",
        "Name",
      ]);

      // 寸法
      const idims =
        productInfo?.ItemDimensions ||
        productInfo?.PackageDimensions ||
        manuInfo?.PackageDimensions;

      const dim = (axis: "Height" | "Length" | "Width" | "Weight") => {
        const node = idims && (idims as any)[axis];
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

      // 材質（互換維持）
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

      (out as any)[asin] = {
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
      } as AmazonOffer;
    }

    await sleep(1600); // 429緩和
  }

  return out;
}
