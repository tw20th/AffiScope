// firebase/functions/src/services/paapi/client.ts
import paapi5sdk from "paapi5-nodejs-sdk";
import { withRetry } from "../../lib/infra/retry.js";
import { leaseToken } from "../../lib/infra/paapiRateLimiter.js";

export type Marketplace =
  | "JP"
  | "US"
  | "UK"
  | "DE"
  | "FR"
  | "CA"
  | "IT"
  | "ES"
  | "IN";

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

type PaapiApi = {
  getItems: (
    req: Record<string, unknown>,
    cb: (err: unknown, data: unknown) => void
  ) => void;
};
type PaapiModule = {
  ApiClient: { instance: any };
  DefaultApi: new () => PaapiApi;
  GetItemsRequest: new () => Record<string, unknown>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function get<T>(obj: unknown, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isRecord(cur) || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur as T;
}

export type OfferHit = {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  price?: number;
  merchant?: string;
  offerCount?: number;
  material?: string;
  dimensions?: any;
  features?: string[];
  url?: string;
};
export type OfferHitMap = Record<string, OfferHit>;

/** サイト別PA-API設定（site.jsonから抽出して渡す） */
export type SitePaapiConfig = {
  accessKey?: string; // できれば site.json に保持（環境変数をフォールバック）
  secretKey?: string;
  partnerTag?: string; // tw20th0c-22 等
  marketplace?: Marketplace; // 省略時 "JP"
  resources?: string[]; // 任意
  // レート（任意、未指定はenvや既定にフォールバック）
  tps?: number; // 例: 0.5 (=2秒に1回)
  burst?: number; // 例: 1
  tpdMax?: number; // 日次上限
};

/** 取得に使う最大のデフォルトResources */
const DEFAULT_RESOURCES = [
  "Images.Primary.Large",
  "ItemInfo.Title",
  "ItemInfo.ByLineInfo",
  "ItemInfo.Features",
  "ItemInfo.ProductInfo",
  "Offers.Summaries.OfferCount",
  "Offers.Listings.Price",
  "Offers.Listings.MerchantInfo",
] as const;

function createSdkClient(cfg: SitePaapiConfig) {
  const ACCESS_KEY = cfg.accessKey || process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = cfg.secretKey || process.env.AMAZON_SECRET_KEY;
  const PARTNER = cfg.partnerTag || process.env.AMAZON_PARTNER_TAG;
  const marketplace: Marketplace = cfg.marketplace || "JP";

  if (!ACCESS_KEY || !SECRET_KEY || !PARTNER) {
    throw new Error("Missing PA-API credentials (access/secret/partnerTag).");
  }

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

  return {
    Paapi,
    partnerTag: PARTNER,
    marketplace,
    accessKey: ACCESS_KEY,
    cfg,
  };
}

/**
 * GetItems の薄いラッパ（ASIN <= 10）
 * - サイト/クレデンシャルごとに Firestore 協調レート制御（leaseToken）
 * - withRetry はHTTP層の一時失敗にのみ使用（429は leaseToken と指数待ちで吸収）
 */
export async function getItemsOnce(
  asins: string[],
  cfg: SitePaapiConfig
): Promise<OfferHitMap> {
  if (!Array.isArray(asins) || asins.length === 0) return {};

  const { Paapi, partnerTag, marketplace, accessKey } = createSdkClient(cfg);
  const api = new Paapi.DefaultApi();

  // レート制御キーは「アクセスキー or パートナータグ or マーケット」
  const limiterKey = accessKey || partnerTag || marketplace;
  await leaseToken({
    keySuffix: limiterKey,
    tps: cfg.tps,
    burst: cfg.burst,
    tpdMax: cfg.tpdMax,
  });

  const req = new Paapi.GetItemsRequest();
  req["PartnerTag"] = partnerTag;
  req["PartnerType"] = "Associates";
  req["ItemIds"] = asins.slice(0, 10);
  req["Resources"] = (
    cfg.resources?.length ? cfg.resources : DEFAULT_RESOURCES
  ).slice();

  const data = await withRetry(
    () =>
      new Promise<unknown>((res, rej) =>
        api.getItems(req, (e: any, d: any) => {
          if (e) return rej(e);
          res(d);
        })
      ),
    1
  );

  const items = get<unknown[]>(data, ["ItemsResult", "Items"]) ?? [];
  const out: OfferHitMap = {};
  for (const it of items) {
    if (!isRecord(it)) continue;
    const asin = (it["ASIN"] as string | undefined) ?? "";
    if (!asin) continue;
    const title = get<string>(it, ["ItemInfo", "Title", "DisplayValue"]);
    const brand = get<string>(it, [
      "ItemInfo",
      "ByLineInfo",
      "Brand",
      "DisplayValue",
    ]);
    const imageUrl = get<string>(it, ["Images", "Primary", "Large", "URL"]);
    const price = get<number>(it, [
      "Offers",
      "Listings",
      "0",
      "Price",
      "Amount",
    ]);
    const merchant = get<string>(it, [
      "Offers",
      "Listings",
      "0",
      "MerchantInfo",
      "Name",
    ]);
    const offerCount = get<number>(it, [
      "Offers",
      "Summaries",
      "0",
      "OfferCount",
    ]);
    const features = (
      get<unknown[]>(it, ["ItemInfo", "Features", "DisplayValues"]) ?? []
    ).filter((x) => typeof x === "string") as string[];
    const material = get<string>(it, [
      "ItemInfo",
      "ProductInfo",
      "Material",
      "DisplayValue",
    ]);
    const dimensions = get<any>(it, [
      "ItemInfo",
      "ProductInfo",
      "ItemDimensions",
    ]);
    const url = (it["DetailPageURL"] as string | undefined) ?? undefined;

    out[asin] = {
      asin,
      title,
      brand,
      imageUrl,
      price,
      merchant,
      offerCount,
      material,
      dimensions,
      features,
      url,
    };
  }
  return out;
}
