// firebase/functions/src/scripts/seedFromAmazon.ts
import "dotenv/config";
import * as admin from "firebase-admin";
import paapi5sdk from "paapi5-nodejs-sdk";
import { upsertProductSeed } from "../upsert/upsertProduct";

if (admin.apps.length === 0) admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

type Argv = {
  site: string;
  category: string;
  keyword: string;
  limit: number;
};

// ---- 小さな引数パーサ ----
function parseArgs(): Argv {
  const args = process.argv.slice(2);
  const get = (k: string, d = "") => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? String(args[i + 1]) : d;
  };
  return {
    site: get("site", "affiscope"),
    category: get("category", "mobile-battery"),
    keyword: get("keyword", "モバイルバッテリー 10000mAh"),
    limit: Number(get("limit", "10")),
  };
}

// ---- ざっくり PA-API SearchItems ----
async function searchAmazonByKeyword(keyword: string) {
  const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
  const SECRET_KEY = process.env.AMAZON_SECRET_KEY;
  const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG;
  if (!ACCESS_KEY || !SECRET_KEY || !PARTNER_TAG) {
    throw new Error(
      "Set AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_PARTNER_TAG"
    );
  }
  delete (process.env as any).AWS_REGION;
  delete (process.env as any).AWS_DEFAULT_REGION;

  const HOST = "webservices.amazon.co.jp";
  const REGION = "us-west-2";

  const Paapi: any = paapi5sdk;
  const client = Paapi.ApiClient.instance;
  client.accessKey = ACCESS_KEY;
  client.secretKey = SECRET_KEY;
  client.host = HOST;
  client.region = REGION;

  const api = new Paapi.DefaultApi();
  const req = new Paapi.SearchItemsRequest();
  req["PartnerTag"] = PARTNER_TAG;
  req["PartnerType"] = "Associates";
  req["Keywords"] = keyword;
  req["SearchIndex"] = "All";
  req["Resources"] = [
    "ItemInfo.Title",
    "ItemInfo.ByLineInfo",
    "Images.Primary.Large",
    "Offers.Listings.Price",
  ];

  const result: any = await new Promise((resolve, reject) =>
    api.searchItems(req, (err: any, data: any) =>
      err ? reject(err) : resolve(data)
    )
  );

  const items: any[] = result?.SearchResult?.Items ?? [];
  return items
    .map((it) => {
      const asin = it?.ASIN as string | undefined;
      const title = it?.ItemInfo?.Title?.DisplayValue as string | undefined;
      const brand = it?.ItemInfo?.ByLineInfo?.Brand?.DisplayValue as
        | string
        | undefined;
      const imageUrl = it?.Images?.Primary?.Large?.URL as string | undefined;
      const price = it?.Offers?.Listings?.[0]?.Price?.Amount as
        | number
        | undefined;
      const url = it?.DetailPageURL as string | undefined;
      if (!asin) return null;
      return { asin, title, brand, imageUrl, price, url };
    })
    .filter(Boolean) as Array<{
    asin: string;
    title?: string;
    brand?: string;
    imageUrl?: string;
    price?: number;
    url?: string;
  }>;
}

async function main() {
  const { site, category, keyword, limit } = parseArgs();

  console.log(`🔎 Amazon 検索: "${keyword}" (limit ${limit})`);
  const items = await searchAmazonByKeyword(keyword);

  let count = 0;
  for (const it of items.slice(0, limit)) {
    await upsertProductSeed({
      asin: it.asin,
      siteId: site,
      categoryId: category,
      title: it.title ?? `商品 ${it.asin}`,
      brand: it.brand ?? "Unknown",
      imageUrl: it.imageUrl,
      price: typeof it.price === "number" ? it.price : undefined,
      url: it.url ?? `https://www.amazon.co.jp/dp/${it.asin}`,
    });
    count++;
    console.log(`✅ saved: ${it.asin} (${it.title ?? ""})`);
  }
  console.log(`🎉 完了: ${count} 件 upsert`);
}

main().catch((e) => {
  console.error("❌ seedFromAmazon failed:", e);
  process.exit(1);
});
