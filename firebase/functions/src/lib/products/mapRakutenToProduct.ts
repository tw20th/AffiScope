import type { RakutenItem } from "../../services/rakuten/client.js";

export type Mapped = {
  asin: string; // ← 楽天の安定キーから生成（site別で前置はしない）
  title: string;
  brand?: string;
  imageUrl?: string;
  siteId: string;
  categoryId: string;
  source: "rakuten";
  url?: string; // productUrl（素URL）
  affiliateUrl?: string; // クリック先
  bestPrice?: {
    price: number;
    url: string;
    source: "rakuten";
    updatedAt: number;
  };
  reviewAverage?: number;
  reviewCount?: number;
  createdAt: number;
  updatedAt: number;
};

function toHiResRakutenImage(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    // _ex=WxH 指定が可能。見栄え用に 600x600 に引き上げ
    if (u.hostname.endsWith("thumbnail.image.rakuten.co.jp")) {
      u.searchParams.set("_ex", "600x600");
      return u.toString().replace(/^http:/, "https:");
    }
    return url.replace(/^http:/, "https:");
  } catch {
    return url.replace(/^http:/, "https:");
  }
}

function pickFirstImage(
  arr?: Array<string | { imageUrl: string }>
): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const v = arr[0];
  const url = typeof v === "string" ? v : v?.imageUrl;
  return toHiResRakutenImage(url);
}

function toNumber(v: any): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace?.(/[, ]/g, "") ?? v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 楽天の安定キーから一意IDを作成（できなければ productUrl をフォールバック） */
function makeStableKey(it: RakutenItem): string {
  // 公式は shopCode:itemCode を推奨。item.itemCode がそれに相当する場合あり
  if (it.itemCode && typeof it.itemCode === "string") {
    return `rk_${it.itemCode}`.slice(0, 120);
  }
  if (it.shopCode && it.itemCode) {
    return `rk_${String(it.shopCode)}:${String(it.itemCode)}`.slice(0, 120);
  }
  const raw = it.itemUrl || it.affiliateUrl || "";
  return `rk_${Buffer.from(raw).toString("base64url").slice(0, 64)}`;
}

export function mapRakutenToProduct(
  it: RakutenItem,
  opts: { siteId: string; categoryId: string; now?: number }
): Mapped {
  const now = opts.now ?? Date.now();

  const productUrl = it.itemUrl || "";
  const affiliateUrl = it.affiliateUrl || productUrl;
  const imageUrl =
    pickFirstImage(it.mediumImageUrls) ||
    pickFirstImage(it.smallImageUrls) ||
    undefined;

  const asin = makeStableKey(it);

  return {
    asin,
    title: it.itemName,
    brand: it.shopName || undefined,
    imageUrl,
    siteId: opts.siteId,
    categoryId: opts.categoryId,
    source: "rakuten",
    url: productUrl,
    affiliateUrl,
    bestPrice:
      typeof it.itemPrice === "number"
        ? {
            price: it.itemPrice,
            url: affiliateUrl, // クリック先はアフィリンクを優先
            source: "rakuten",
            updatedAt: now,
          }
        : undefined,
    reviewAverage: toNumber(it.reviewAverage),
    reviewCount: toNumber(it.reviewCount),
    createdAt: now,
    updatedAt: now,
  };
}
