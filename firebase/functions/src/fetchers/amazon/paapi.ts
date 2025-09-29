// firebase/functions/src/fetchers/amazon/paapi.ts
import paapi5sdk from "paapi5-nodejs-sdk";
import { withRetry } from "../../lib/retry.js";

// price/url を必須にしない（undefined 許容）
export type AmazonOffer = {
  price?: number;
  url?: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function get<T>(obj: unknown, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur) || !(key in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as T;
}

/** 10件ずつ */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 仕様に合うASINだけ通す（10桁英数大文字） */
function isValidAsin(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}

// Search/Get どちらも有効な Resources（Brand は ByLineInfo 全体）
const FULL_RESOURCES = [
  "ItemInfo.Title",
  "Images.Primary.Large",
  "Offers.Listings.Price",
  "ItemInfo.ByLineInfo",
] as const;

const MIN_RESOURCES = ["ItemInfo.Title", "Offers.Listings.Price"] as const;

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

  // 署名干渉を避ける
  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;
  delete (process.env as any).AMAZON_REGION;

  const Paapi: any = paapi5sdk;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.host = "webservices.amazon.co.jp"; // JP
  client.region = "us-west-2"; // JPはus-west-2

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
          api.getItems(req, (error: any, result: any) => {
            if (error) return reject(error);
            resolve(result);
          });
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
    if (group.length === 0) continue;
    let data: any;
    try {
      data = await callOnce(group, false);
    } catch (e1: any) {
      try {
        const status = e1?.status ?? e1?.response?.status ?? e1?.code ?? "";
        const body =
          e1?.response?.data ?? e1?.response?.text ?? e1?.message ?? "";
        console.warn(
          "[PAAPI] fallback minimal resources due to:",
          status,
          body
        );
        data = await callOnce(group, true);
      } catch (e2: any) {
        const status = e2?.status ?? e2?.response?.status ?? e2?.code ?? "";
        const body =
          e2?.response?.data ?? e2?.response?.text ?? e2?.message ?? "";
        console.error("[PAAPI] getItems FAILED", { status, body, group });
        for (const a of group) out[a] = null;
        continue;
      }
    }

    const items = get<unknown[]>(data, ["ItemsResult", "Items"]) ?? [];
    for (const it of items) {
      if (!isRecord(it)) continue;
      const asin = (it["ASIN"] as string | undefined) ?? undefined;
      if (!asin) continue;

      const title = get<string>(it, ["ItemInfo", "Title", "DisplayValue"]);
      const brand = get<string>(it, [
        "ItemInfo",
        "ByLineInfo",
        "Brand",
        "DisplayValue",
      ]);
      const price = get<number>(it, [
        "Offers",
        "Listings",
        "0",
        "Price",
        "Amount",
      ]);
      const url = (it["DetailPageURL"] as string | undefined) ?? undefined; // ← GetItems は Resources 指定不要で返る
      const imageUrl = get<string>(it, ["Images", "Primary", "Large", "URL"]);

      // ★ ここを緩める：price / url が無くても “null にしない”
      out[asin] = { price, url, title, brand, imageUrl };
    }
  }

  return out;
}
