import paapi5sdk from "paapi5-nodejs-sdk";

type MaybeClient = {
  accessKey?: string;
  secretKey?: string;
  host?: string;
  region?: string;
  setHost?: (h: string) => void;
  setRegion?: (r: string) => void;
};
interface PaapiApi {
  searchItems: (
    req: Record<string, unknown>,
    cb: (error: unknown, data: unknown) => void
  ) => void;
}
interface PaapiModule {
  ApiClient: { instance: MaybeClient };
  DefaultApi: new () => PaapiApi;
  SearchItemsRequest: new () => Record<string, unknown>;
}

type Item = {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  price?: number;
  url?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function get<T>(obj: unknown, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isRecord(cur) || !(k in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as T;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const status = e?.status;
      const retriable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        /Throttl|TooMany|Limit/i.test(
          String(e?.message || "") + String(e?.response?.text || "")
        );
      if (!retriable || i === tries - 1) throw last;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw last;
}

export async function searchAmazonItems(
  keyword: string,
  limit = 10
): Promise<Item[]> {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG;
  if (!ACCESS_KEY || !SECRET_KEY || !PARTNER_TAG)
    throw new Error("Missing PA-API creds.");

  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;
  delete (process.env as any).AMAZON_REGION;

  const Paapi = paapi5sdk as unknown as PaapiModule;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.setHost?.("webservices.amazon.co.jp");
  client.host = "webservices.amazon.co.jp";
  client.setRegion?.("us-west-2");
  client.region = "us-west-2";

  const api = new Paapi.DefaultApi();
  const req = new Paapi.SearchItemsRequest();
  req["PartnerTag"] = PARTNER_TAG;
  req["PartnerType"] = "Associates";
  req["Keywords"] = keyword;
  req["ItemCount"] = Math.min(Math.max(limit, 1), 10);
  req["Resources"] = [
    "ItemInfo.Title",
    "ItemInfo.ByLineInfo",
    "Images.Primary.Large",
    "Offers.Listings.Price",
  ];

  const data = await withRetry(
    () =>
      new Promise<unknown>((res, rej) =>
        api.searchItems(req, (e, d) => (e ? rej(e) : res(d)))
      ),
    3
  );
  const items = get<unknown[]>(data, ["SearchResult", "Items"]) ?? [];
  const out: Item[] = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const asin = (it["ASIN"] as string | undefined) ?? "";
    if (!asin) continue;
    out.push({
      asin,
      title: get<string>(it, ["ItemInfo", "Title", "DisplayValue"]),
      brand: get<string>(it, [
        "ItemInfo",
        "ByLineInfo",
        "Brand",
        "DisplayValue",
      ]),
      imageUrl: get<string>(it, ["Images", "Primary", "Large", "URL"]),
      price: get<number>(it, ["Offers", "Listings", "0", "Price", "Amount"]),
      url: (it["DetailPageURL"] as string | undefined) ?? undefined,
    });
  }
  return out;
}
