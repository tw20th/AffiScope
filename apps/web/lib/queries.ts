// apps/web/lib/queries.ts
import type { Product } from "@affiscope/shared-types";
import {
  fsGet,
  fsRunQuery,
  fsGetString as vStr,
  fsGetNumber as vNum,
  fsGetStringArray as vStrArr,
  fsGetBoolean as vBool,
  docIdFromName,
} from "@/lib/firestore-rest";

/* ===== products ===== */

export async function fetchProductByAsin(
  asin: string,
  siteId: string
): Promise<Product | null> {
  const doc = await fsGet({ path: `products/${encodeURIComponent(asin)}` });
  if (!doc) return null;

  const f = doc.fields;

  const bpPrice = vNum(f, "bestPrice.price");
  const bpUrl = vStr(f, "bestPrice.url");
  const bpSource = vStr(f, "bestPrice.source") as
    | "amazon"
    | "rakuten"
    | undefined;
  const bpUpdatedAt = vNum(f, "bestPrice.updatedAt");

  const bestPrice =
    typeof bpPrice === "number" &&
    typeof bpUpdatedAt === "number" &&
    bpUrl &&
    bpSource
      ? { price: bpPrice, url: bpUrl, source: bpSource, updatedAt: bpUpdatedAt }
      : undefined;

  return {
    asin,
    title: vStr(f, "title") ?? "",
    brand: vStr(f, "brand") ?? undefined,
    imageUrl: vStr(f, "imageUrl") ?? undefined,
    categoryId: vStr(f, "categoryId") ?? "",
    siteId,
    affiliateUrl: vStr(f, "affiliateUrl") ?? undefined,
    url: vStr(f, "url") ?? undefined,
    inStock: vBool(f, "inStock"),
    lastSeenAt: vNum(f, "lastSeenAt"),
    source:
      (vStr(f, "source") as "amazon" | "rakuten" | undefined) ?? undefined,
    tags: vStrArr(f, "tags") ?? [],
    specs: undefined,
    offers: [],
    bestPrice,
    priceHistory: [],
    aiSummary: vStr(f, "aiSummary") ?? undefined,
    views: vNum(f, "views") ?? 0,
    createdAt: vNum(f, "createdAt") ?? 0,
    updatedAt: vNum(f, "updatedAt") ?? 0,
  };
}

export async function fetchRelated(
  siteId: string,
  categoryId: string,
  excludeAsin: string,
  limit = 8
) {
  if (!categoryId) return [];
  const docs = await fsRunQuery({
    collection: "products",
    where: [
      { field: "siteId", value: siteId },
      { field: "categoryId", value: categoryId },
    ],
    orderBy: [{ field: "createdAt", direction: "DESCENDING" }],
    limit: limit + 2,
  }).catch(() => [] as any[]);

  const rows: Product[] = docs.map((d: any) => {
    const f = d.fields;
    return {
      asin: docIdFromName(d.name),
      title: vStr(f, "title") ?? "",
      brand: vStr(f, "brand") ?? undefined,
      imageUrl: vStr(f, "imageUrl") ?? undefined,
      categoryId: vStr(f, "categoryId") ?? "",
      siteId,
      tags: [],
      specs: undefined,
      offers: [],
      bestPrice: (() => {
        const price = vNum(f, "bestPrice.price");
        const url = vStr(f, "bestPrice.url");
        const source = vStr(f, "bestPrice.source") as
          | "amazon"
          | "rakuten"
          | undefined;
        const updatedAt = vNum(f, "bestPrice.updatedAt");
        return typeof price === "number" &&
          url &&
          source &&
          typeof updatedAt === "number"
          ? { price, url, source, updatedAt }
          : undefined;
      })(),
      priceHistory: [],
      aiSummary: undefined,
      views: vNum(f, "views") ?? 0,
      createdAt: vNum(f, "createdAt") ?? 0,
      updatedAt: vNum(f, "updatedAt") ?? 0,
    } as Product;
  });

  return rows.filter((p) => p.asin !== excludeAsin).slice(0, limit);
}

/* 関連ブログ（この商品を題材にしている記事） */
export type MiniBlog = {
  slug: string;
  title: string;
  publishedAt?: number;
  updatedAt?: number;
};
export async function fetchBlogsByRelatedAsin(
  siteId: string,
  asin: string,
  limit = 6
): Promise<MiniBlog[]> {
  const docs = await fsRunQuery({
    collection: "blogs",
    where: [
      { field: "siteId", value: siteId },
      { field: "relatedAsin", value: asin }, // EQUAL
      { field: "status", value: "published" },
    ],
    orderBy: [{ field: "publishedAt", direction: "DESCENDING" as const }],
    limit,
  }).catch(() => [] as any[]);
  return docs.map((d: any) => ({
    slug: docIdFromName(d.name),
    title: vStr(d.fields, "title") ?? "(no title)",
    publishedAt: vNum(d.fields, "publishedAt") ?? undefined,
    updatedAt: vNum(d.fields, "updatedAt") ?? undefined,
  }));
}

/* ===== blogs ===== */

export type BlogRow = {
  slug: string;
  title: string;
  summary?: string | null;
  imageUrl?: string | null;
  /** ★ 追加: Unsplash 帰属 */
  imageCredit?: string | null;
  imageCreditLink?: string | null;

  publishedAt?: number;
  updatedAt?: number;
  views?: number;
};

export async function fetchBlogs(
  siteId: string,
  orderBy: { field: string; direction: "DESCENDING" | "ASCENDING" }[],
  take = 40
) {
  const docs = await fsRunQuery({
    collection: "blogs",
    where: [
      { field: "status", value: "published" },
      { field: "siteId", value: siteId },
    ],
    orderBy,
    limit: take,
  }).catch(() => [] as any[]);

  const rows: BlogRow[] = docs.map((d: any) => ({
    slug: docIdFromName(d.name),
    title: vStr(d.fields, "title") ?? "(no title)",
    summary: vStr(d.fields, "summary") ?? null,
    imageUrl: vStr(d.fields, "imageUrl") ?? null,
    imageCredit: vStr(d.fields, "imageCredit") ?? null, // ★ 追加
    imageCreditLink: vStr(d.fields, "imageCreditLink") ?? null, // ★ 追加
    publishedAt: vNum(d.fields, "publishedAt") ?? undefined,
    updatedAt: vNum(d.fields, "updatedAt") ?? undefined,
    views: vNum(d.fields, "views") ?? 0,
  }));

  return rows;
}

/* ブログ本文＋最安（詳細ページ用） */
export async function fetchBlogBySlug(slug: string) {
  const doc = await fsGet({ path: `blogs/${slug}` }).catch(() => null);
  if (!doc) return null;
  const f = (doc as any).fields;
  return {
    slug,
    title: vStr(f, "title") ?? "(no title)",
    content: vStr(f, "content") ?? "",
    imageUrl: vStr(f, "imageUrl") ?? undefined,
    /** ★ 追加: Unsplash 帰属 */
    imageCredit: vStr(f, "imageCredit") ?? null,
    imageCreditLink: vStr(f, "imageCreditLink") ?? null,

    summary: vStr(f, "summary") ?? undefined,
    siteId: vStr(f, "siteId") ?? "",
    updatedAt: vNum(f, "updatedAt") ?? undefined,
    publishedAt: vNum(f, "publishedAt") ?? undefined,
    relatedAsin: vStr(f, "relatedAsin") ?? null,
  };
}

export async function fetchBestPrice(asin: string) {
  const doc = await fsGet({ path: `products/${asin}` }).catch(() => null);
  const f = (doc as any)?.fields;
  if (!f) return null;
  const price = vNum(f, "bestPrice.price");
  const url = vStr(f, "bestPrice.url");
  const source = vStr(f, "bestPrice.source") as
    | "amazon"
    | "rakuten"
    | "rakuten"
    | undefined;
  const updatedAt = vNum(f, "bestPrice.updatedAt");
  if (
    typeof price === "number" &&
    url &&
    source &&
    typeof updatedAt === "number"
  ) {
    return { price, url, source, updatedAt };
  }
  return null;
}
