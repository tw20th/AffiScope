import paapi5sdk from "paapi5-nodejs-sdk";

/** 軽量リトライ（429/5xxのみ再試行） */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      const retriable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        /Throttl|TooMany|Limit/i.test(
          String(e?.message) + String(e?.response?.text)
        );

      if (!retriable || i === tries - 1) throw lastErr;

      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/** 出力フォーマット */
export type AmazonOffer = {
  price: number;
  url: string;
  title?: string;
  brand?: string;
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

export async function fetchAmazonOffers(
  asins: string[]
): Promise<Record<string, AmazonOffer | null>> {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG;

  if (!ACCESS_KEY || !SECRET_KEY || !PARTNER_TAG) {
    console.error("[PAAPI] Missing credentials. Have keys?", {
      hasAK: !!ACCESS_KEY,
      hasSK: !!SECRET_KEY,
      hasPT: !!PARTNER_TAG,
    });
    return Object.fromEntries(asins.map((a) => [a, null]));
  }

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
  const req = new Paapi.GetItemsRequest();
  req["PartnerTag"] = PARTNER_TAG;
  req["PartnerType"] = "Associates";
  req["ItemIds"] = asins;
  req["Resources"] = [
    "ItemInfo.Title",
    "Images.Primary.Large",
    "Offers.Listings.Price",
    "ItemInfo.ByLineInfo.Brand",
  ];

  let data: unknown;
  try {
    data = await withRetry(
      () =>
        new Promise((resolve, reject) => {
          api.getItems(req, (error: any, result: any) => {
            if (error) return reject(error);
            resolve(result);
          });
        }),
      3
    );
  } catch (e: any) {
    // ここで詳細ログを必ず出す＆空で返す（落とさない）
    const status = e?.status ?? e?.response?.status;
    const body = e?.response?.text ?? e?.response?.body ?? e?.message;
    console.error("[PAAPI] getItems FAILED", { status, body });
    return Object.fromEntries(asins.map((a) => [a, null]));
  }

  const items = get<unknown[]>(data, ["ItemsResult", "Items"]) ?? [];
  const out: Record<string, AmazonOffer | null> = {};

  for (const it of items) {
    if (!isRecord(it)) continue;
    const asin = (it["ASIN"] as string | undefined) ?? undefined;
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
    const url = (it["DetailPageURL"] as string | undefined) ?? undefined;
    if (!asin) continue;
    out[asin] =
      typeof price === "number" && url ? { price, url, title, brand } : null;
  }

  for (const a of asins) if (!(a in out)) out[a] = null;
  return out;
}
