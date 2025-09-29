import paapi5sdk from "paapi5-nodejs-sdk";
import { withRetry } from "../../lib/retry.js";

interface PaapiApi {
  searchItems: (
    req: Record<string, unknown>,
    cb: (error: unknown, data: unknown) => void
  ) => void;
}
interface PaapiModule {
  ApiClient: { instance: any };
  DefaultApi: new () => PaapiApi;
  SearchItemsRequest: new () => Record<string, unknown>;
}

export type Item = {
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

// ✅ SearchItems 用の正しい Resources（DetailPageURL は入れない）
const SEARCH_RESOURCES = [
  "ItemInfo.Title",
  "ItemInfo.ByLineInfo",
  "Images.Primary.Large",
  "Offers.Listings.Price",
] as const;

export async function searchAmazonItems(
  keyword: string,
  limit = 10,
  page = 1,
  opts?: { sortBy?: string; searchIndex?: string }
): Promise<Item[]> {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG;
  if (!ACCESS_KEY || !SECRET_KEY || !PARTNER_TAG)
    throw new Error("Missing PA-API creds.");

  // 署名干渉を避ける
  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;
  delete (process.env as any).AMAZON_REGION;

  const Paapi = paapi5sdk as unknown as PaapiModule;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.host = "webservices.amazon.co.jp";
  client.region = "us-west-2";

  const api = new Paapi.DefaultApi();
  const req = new Paapi.SearchItemsRequest();
  req["PartnerTag"] = PARTNER_TAG;
  req["PartnerType"] = "Associates";
  req["Keywords"] = keyword;
  req["ItemCount"] = Math.min(Math.max(limit, 1), 10);
  req["ItemPage"] = Math.min(Math.max(page, 1), 10);
  if (opts?.sortBy) req["SortBy"] = opts.sortBy;
  if (opts?.searchIndex) req["SearchIndex"] = opts.searchIndex;
  req["Resources"] = [...SEARCH_RESOURCES];

  const data = await withRetry(
    () =>
      new Promise<unknown>((res, rej) =>
        api.searchItems(req, (e, d) => (e ? rej(e) : res(d)))
      ),
    3
  ).catch((e: any) => {
    const status = e?.status ?? e?.response?.status ?? e?.code ?? "";
    const body =
      e?.response?.data ?? e?.response?.text ?? e?.message ?? String(e);
    console.error("[searchAmazonItems] failed:", { status, body });
    throw e;
  });

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
      // ← リソース指定不要でも返ってくる
      url: (it["DetailPageURL"] as string | undefined) ?? undefined,
    });
  }
  return out;
}
