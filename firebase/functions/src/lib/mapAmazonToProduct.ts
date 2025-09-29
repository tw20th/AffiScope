// firebase/functions/src/lib/mapAmazonToProduct.ts
import type { Product } from "@affiscope/shared-types";

/** Amazon の取得結果を受け取る軽量型（必要最低限） */
export interface AmazonItem {
  ASIN: string;
  Title?: string;
  Brand?: string;
  ImageUrl?: string;
  Price?: number; // 円
  DetailPageURL?: string;
}

/** URL 妥当性の軽いガード（壊れたURLは undefined にする） */
function safeUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    new URL(u);
    return u;
  } catch {
    return undefined;
  }
}

/**
 * AmazonItem -> Product 変換
 * - 実行時バリデーション（Zod等）は行わず、型注釈のみで返します
 * - Firestore の products ドキュメントにそのまま保存できる形
 */
export function mapAmazonItemToProduct(
  it: AmazonItem,
  opts: { siteId: string; categoryId: string }
): Product {
  const now = Date.now();
  const detailUrl =
    it.DetailPageURL || `https://www.amazon.co.jp/dp/${it.ASIN}`;

  const price =
    typeof it.Price === "number" && isFinite(it.Price) ? it.Price : undefined;

  const product: Product = {
    asin: it.ASIN,
    title: it.Title || it.ASIN,
    brand: it.Brand,
    imageUrl: safeUrl(it.ImageUrl),
    categoryId: opts.categoryId,
    siteId: opts.siteId,

    // optional
    tags: [],
    specs: undefined,

    // 価格系（ある場合のみ bestPrice / offers / priceHistory を作る）
    bestPrice: price
      ? {
          price,
          source: "amazon",
          url: detailUrl,
          updatedAt: now,
        }
      : undefined,

    offers: price
      ? [
          {
            source: "amazon",
            price,
            url: detailUrl,
            lastSeenAt: now,
          },
        ]
      : [],

    priceHistory: price
      ? [
          {
            ts: now,
            source: "amazon",
            price,
          },
        ]
      : [],

    aiSummary: undefined,
    views: 0,
    createdAt: now,
    updatedAt: now,
  };

  return product;
}
