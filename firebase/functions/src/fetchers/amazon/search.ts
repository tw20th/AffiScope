// firebase/functions/src/fetchers/amazon/search.ts
import paapi5sdk from "paapi5-nodejs-sdk";
import { withRetry } from "../../lib/retry.js";

type Marketplace = "JP" | "US" | "UK" | "DE" | "FR" | "CA" | "IT" | "ES" | "IN";
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

const SEARCH_RESOURCES = [
  "ItemInfo.Title",
  "ItemInfo.ByLineInfo",
  "Images.Primary.Large",
  "Offers.Listings.Price",
] as const;

type SearchOpts = {
  sortBy?: string;
  searchIndex?: string;
  partnerTag?: string;
  marketplace?: Marketplace;
};

function createClient(opts?: SearchOpts) {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const FALLBACK_PARTNER = process.env.AMAZON_PARTNER_TAG;

  const partnerTag = opts?.partnerTag || FALLBACK_PARTNER;
  const marketplace: Marketplace = opts?.marketplace || "JP";
  if (!ACCESS_KEY || !SECRET_KEY || !partnerTag)
    throw new Error("Missing PA-API creds.");

  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;
  delete (process.env as any).AMAZON_REGION;

  const ep = ENDPOINTS[marketplace];
  const Paapi = paapi5sdk as unknown as PaapiModule;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.host = ep.host;
  client.region = ep.region;

  return { Paapi, partnerTag };
}

/** 検索API（サイト別 partnerTag / marketplace を利用） */
export async function searchAmazonItems(
  keyword: string,
  limit = 10,
  page = 1,
  opts?: SearchOpts
): Promise<Item[]> {
  const { Paapi, partnerTag } = createClient(opts);

  const api = new Paapi.DefaultApi();
  const req = new Paapi.SearchItemsRequest();
  req["PartnerTag"] = partnerTag;
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
      url: (it["DetailPageURL"] as string | undefined) ?? undefined,
    });
  }
  return out;
}
