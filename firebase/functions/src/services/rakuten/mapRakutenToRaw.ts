// ESM / any禁止
import { createHash } from "node:crypto";

export type RakutenRawDoc = {
  siteId: string; // どのサイトの収集で来たか
  itemCode?: string; // shopCode:itemCode（安定キー）
  itemUrl: string; // 商品ページ
  affiliateUrl?: string; // 返ってきたらそのまま
  shopName?: string;
  shopCode?: string;
  shopUrl?: string;

  title: string; // itemName の正規化
  price: number; // itemPrice
  imageUrl?: string; // 600x600に寄せたURL（あれば）

  reviewAverage?: number;
  reviewCount?: number;
  genreId?: string;

  // 監査系
  fetchedAt: number; // この取り込みの時刻
  updatedAt: number; // 同一docの最新更新
  source: "rakuten";
  raw?: unknown; // オリジナルを必要なら保持（将来の検証用）
};

function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace?.(/[,\s]/g, "") ?? v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function hiRes(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("thumbnail.image.rakuten.co.jp")) {
      u.searchParams.set("_ex", "600x600");
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** APIレスポンス1件 → rawドキュメント */
export function mapRakutenToRaw(
  siteId: string,
  item: Record<string, unknown>,
  now = Date.now()
): RakutenRawDoc {
  const medium0 = Array.isArray(item?.mediumImageUrls as unknown[])
    ? (item?.mediumImageUrls as any[])[0]
    : undefined;
  const firstMedium = typeof medium0 === "string" ? medium0 : medium0?.imageUrl;

  const price =
    toNum(item?.itemPrice) ??
    toNum((item as any)?.itemPriceMin) ??
    toNum((item as any)?.itemPriceMax) ??
    0;

  return {
    siteId,
    itemCode:
      typeof item?.itemCode === "string"
        ? (item.itemCode as string)
        : undefined,
    itemUrl: String(item?.itemUrl ?? ""),
    affiliateUrl:
      typeof item?.affiliateUrl === "string"
        ? (item.affiliateUrl as string)
        : undefined,
    shopName:
      typeof item?.shopName === "string"
        ? (item.shopName as string)
        : undefined,
    shopCode:
      typeof item?.shopCode === "string"
        ? (item.shopCode as string)
        : undefined,
    shopUrl:
      typeof item?.shopUrl === "string" ? (item.shopUrl as string) : undefined,

    title: String(item?.itemName ?? "").trim(),
    price,
    imageUrl: hiRes(firstMedium ?? (item as any)?.imageUrl),

    reviewAverage: toNum(item?.reviewAverage),
    reviewCount: toNum(item?.reviewCount),
    genreId:
      typeof item?.genreId === "number"
        ? String(item.genreId)
        : (item?.genreId as string | undefined),

    fetchedAt: now,
    updatedAt: now,
    source: "rakuten",
    // 必要に応じてコメントアウト解除
    // raw: item,
  };
}

/** rawドキュメントID：itemCodeがあればそれを、なければURLハッシュ */
export function rawDocIdFor(item: {
  itemCode?: string;
  itemUrl: string;
}): string {
  if (item.itemCode && item.itemCode.length <= 128) return item.itemCode;
  return createHash("sha1").update(item.itemUrl).digest("hex");
}
