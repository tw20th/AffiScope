// firebase/functions/src/lib/mapAmazonToProduct.ts
import type { Product } from "@affiscope/shared-types";

/** Amazon の取得結果を受ける軽量型 */
export interface AmazonItem {
  ASIN: string;
  Title?: string;
  Brand?: string;
  ImageUrl?: string;
  Price?: number; // 円
  DetailPageURL?: string;

  // 追加フィールド（paapi.ts で拾えるもの）
  Features?: string[];
  Dimensions?: {
    height?: { value: number; unit: string };
    length?: { value: number; unit: string };
    width?: { value: number; unit: string };
    weight?: { value: number; unit: string };
  };
  Material?: string;
  WarrantyText?: string;
  MerchantName?: string;
  OfferCount?: number;

  // 将来拡張（PA-APIで取れないことが多いので undefined でもOK）
  Rating?: number; // 0.0 - 5.0
  ReviewCount?: number; // 件数
  InStock?: boolean; // 在庫（不明なら undefined）
}

/** URL 妥当性の軽いガード */
function safeUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    new URL(u);
    return u;
  } catch {
    return undefined;
  }
}

/** スラッグは siteId_ASIN を基本形に統一 */
function makeSlug(siteId: string, asin: string): string {
  return `${siteId}_${asin}`;
}

export function mapAmazonItemToProduct(
  it: AmazonItem,
  opts: { siteId: string; categoryId: string }
): Product {
  const now = Date.now();
  const detailUrl =
    it.DetailPageURL || `https://www.amazon.co.jp/dp/${it.ASIN}`;
  const price =
    typeof it.Price === "number" && isFinite(it.Price) ? it.Price : undefined;

  // ---- specs は常に“器”を作る（空でも存在させる）
  const specs = {
    dimensions: it.Dimensions,
    material: it.Material ?? "",
    features: Array.isArray(it.Features) ? it.Features : [],
  } as unknown as Product["specs"];

  // trust は shared-types に無い可能性があるので、動的に追加
  const trust =
    it.WarrantyText || it.MerchantName || typeof it.OfferCount === "number"
      ? {
          merchant: it.MerchantName,
          offerCount: it.OfferCount,
          warranty: it.WarrantyText,
        }
      : undefined;

  const base: Product = {
    asin: it.ASIN,
    title: it.Title || it.ASIN,
    brand: it.Brand,
    imageUrl: safeUrl(it.ImageUrl),
    categoryId: opts.categoryId,
    siteId: opts.siteId,

    // 既定（空でも器を確保）
    tags: [],
    specs,

    // 価格関連
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

    // 生成系
    aiSummary: "",

    // 管理系
    views: 0,
    createdAt: now,
    updatedAt: now,
  };

  // ここから “標準フィールド” をトップレベルに動的追加
  const extra: Record<string, unknown> = {
    // スラッグ統一
    slug: makeSlug(opts.siteId, it.ASIN),

    // UI で参照しやすいように affiliateUrl をトップにも複製
    affiliateUrl: detailUrl,

    // 検索で便利なのでトップにも lastSeenAt を複製（offers が無ければ createdAt）
    lastSeenAt: now,

    // 在庫はわからなければ undefined のまま
    inStock: typeof it.InStock === "boolean" ? it.InStock : undefined,
    availability:
      typeof it.InStock === "boolean"
        ? it.InStock
          ? "in_stock"
          : "out_of_stock"
        : "unknown",

    // 将来のための器（PA-APIでは原則取れない）
    rating: typeof it.Rating === "number" ? it.Rating : undefined,
    reviewCount:
      typeof it.ReviewCount === "number" ? it.ReviewCount : undefined,
  };

  if (trust) (extra as Record<string, unknown>).trust = trust;

  // Product 型に存在しないフィールドは動的に付与
  Object.assign(base as unknown as Record<string, unknown>, extra);

  return base;
}
