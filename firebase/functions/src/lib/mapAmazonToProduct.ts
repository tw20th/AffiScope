// firebase/functions/src/lib/mapAmazonToProduct.ts
import { ProductSchema } from "@affiscope/shared-types";
import type { Product } from "@affiscope/shared-types";
import type { AmazonItem } from "./amazon";

const safeUrl = (s?: string) => {
  try {
    if (!s) return undefined;
    // 例: 相対/空は落とす。new URL が通ればOK
    new URL(s);
    return s;
  } catch {
    return undefined;
  }
};

export function mapAmazonItemToProduct(
  it: AmazonItem,
  opts: { siteId: string; categoryId: string }
): Product {
  const now = Date.now();
  const detailUrl =
    it.DetailPageURL || `https://www.amazon.co.jp/dp/${it.ASIN}`;

  const candidate = {
    asin: it.ASIN,
    title: it.Title || it.ASIN,
    brand: it.Brand,
    imageUrl: safeUrl(it.ImageUrl), // ★ ここでバリデーション
    categoryId: opts.categoryId,
    siteId: opts.siteId,
    tags: [] as string[],
    specs: undefined,
    bestPrice: it.Price
      ? {
          price: it.Price,
          source: "amazon" as const,
          url: detailUrl,
          updatedAt: now,
        }
      : undefined,
    offers: it.Price
      ? [
          {
            source: "amazon" as const,
            price: it.Price,
            url: detailUrl,
            lastSeenAt: now,
          },
        ]
      : [],
    priceHistory: it.Price
      ? [
          {
            ts: now,
            source: "amazon" as const,
            price: it.Price,
          },
        ]
      : [],
    aiSummary: undefined,
    views: 0,
    createdAt: now,
    updatedAt: now,
  };

  return ProductSchema.parse(candidate);
}
