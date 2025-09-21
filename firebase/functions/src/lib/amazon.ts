// firebase/functions/src/lib/amazon.ts
import "dotenv/config";

/** 入力: ASIN配列 / 出力: PA-APIの生レスポンス配列（必要最低限） */
export interface AmazonItem {
  ASIN: string;
  Title?: string;
  Brand?: string;
  ImageUrl?: string;
  Price?: number; // 円
  DetailPageURL?: string;
}

const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.AMAZON_SECRET_KEY ?? "";
const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG ?? "";

const HOST = process.env.AMAZON_HOST || "webservices.amazon.co.jp";
const REGION = process.env.AMAZON_REGION || "us-west-2"; // ← 統一（JPはus-west-2）

// 念のため：実行時の既定AWSリージョンは参照しない（SDK側で読むのを防ぐ）
delete (process.env as Record<string, unknown>)["AWS_REGION"];
delete (process.env as Record<string, unknown>)["AWS_DEFAULT_REGION"];

/**
 * 任意のPA-API SDKに差し替え可能
 * - 例：paapi5-nodejs-sdk の GetItems を呼び、必要フィールドだけ抜き出す
 */
export async function getAmazonItems(asins: string[]): Promise<AmazonItem[]> {
  // ここはダミー実装（本番では fetchers/amazon/paapi.ts を使用推奨）
  // 署名&リージョンの一貫性のため、HOST/REGION は上の定義を使ってください
  return asins.map((a) => ({
    ASIN: a,
    Title: `Dummy ${a}`,
    Brand: "Brand",
    ImageUrl: "",
    Price: 1980,
    DetailPageURL: `https://www.amazon.co.jp/dp/${a}/?tag=${PARTNER_TAG}`,
  }));
}

// エクスポート（他モジュールがHOST/REGIONを見る用途）
export const AMAZON_ENDPOINT = {
  HOST,
  REGION,
  PARTNER_TAG,
  ACCESS_KEY_SET: !!ACCESS_KEY && !!SECRET_KEY,
};
