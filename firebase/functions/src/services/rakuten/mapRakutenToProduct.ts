// firebase/functions/src/services/rakuten/mapRakutenToProduct.ts
/* Rakuten API のレスポンス → 共通 Product へマッピング */
import type { Product } from "@affiscope/shared-types";

type MapParams = {
  siteId: string;
  categoryIdFallback: string;
  // Rakuten IchibaItem の 1 アイテム相当
  item: any;
  now?: number;
};

function toNumber(v: any): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace?.(/[, ]/g, "") ?? v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toHiResRakutenImage(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    // 楽天サムネCDNは _ex=WxH でサイズ指定。600x600 に上げる
    if (u.hostname.endsWith("thumbnail.image.rakuten.co.jp")) {
      u.searchParams.set("_ex", "600x600");
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function mapRakutenToProduct(params: MapParams): Product {
  const { siteId, categoryIdFallback, item } = params;
  const now = Date.now();

  // 安全にURL文字列化（affiliateUrl があれば優先）
  const rawUrl =
    typeof item?.affiliateUrl === "string"
      ? item.affiliateUrl
      : typeof item?.itemUrl === "string"
      ? item.itemUrl
      : "";

  // 画像の取り出し（string / { imageUrl } の両対応）
  const medium0 = item?.mediumImageUrls?.[0];
  const firstMedium = typeof medium0 === "string" ? medium0 : medium0?.imageUrl;
  const imageUrl = toHiResRakutenImage(firstMedium ?? item?.imageUrl) ?? "";

  const price =
    toNumber(item?.itemPrice) ??
    toNumber(item?.itemPriceMin) ??
    toNumber(item?.itemPriceMax) ??
    0;

  // Product 必須フィールドを満たすベース
  const base: Product = {
    asin: Buffer.from(rawUrl).toString("base64url").slice(0, 64),
    siteId,
    categoryId: categoryIdFallback,
    title: String(item?.itemName ?? "").trim(),
    brand: typeof item?.shopName === "string" ? item.shopName : undefined,
    imageUrl,
    bestPrice: {
      price,
      url: rawUrl,
      source: "rakuten",
      updatedAt: now,
    },
    // schema 上必須の可能性があるので空で初期化
    offers: [],
    priceHistory: [],
    // メタ
    views: 0,
    createdAt: now,
    updatedAt: now,
  };

  // ---- 追加で持っておくと便利な拡張（Firestore には保存可 / 型は緩く）----
  // Product 型に存在しないフィールド（affiliateUrl 等）は here に積む
  const withExtras = {
    ...base,
    reviewAverage: toNumber(item?.reviewAverage),
    reviewCount: toNumber(item?.reviewCount) ?? 0,
    rakutenExtras: {
      affiliateUrl: rawUrl, // 生のアフィリンクは拡張側に保持
      shopName: item?.shopName,
      shopUrl: item?.shopUrl,
      shopCode: item?.shopCode,
      genreId:
        typeof item?.genreId === "number"
          ? String(item.genreId)
          : item?.genreId,
    },
  } as any as Product;

  return withExtras;
}
