// apps/web/app/page.tsx
import Link from "next/link";
import Image from "next/image";
// ❌ import { fetchProducts } from "@/lib/products"; を削除
import type { Product } from "@affiscope/shared-types";

// Firestore REST
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";

export const revalidate = 60;
// 追加：ビルド時に接続しない（このページは動的SSR扱い）
export const dynamic = "force-dynamic";

function jpy(n?: number) {
  if (typeof n !== "number") return "";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
  }).format(n);
}

/** RESTで最新ブログ N件 */
async function fetchLatestBlogs(siteId: string, limit = 3) {
  const docs = await fsRunQuery({
    collection: "blogs",
    where: [
      { field: "status", value: "published" },
      { field: "siteId", value: siteId },
    ],
    orderBy: [{ field: "updatedAt", direction: "DESCENDING" }],
    limit,
  });

  return docs.map((d) => ({
    slug: docIdFromName(d.name),
    title: vStr(d.fields, "title") ?? "(no title)",
    summary: vStr(d.fields, "summary") ?? "",
    imageUrl: vStr(d.fields, "imageUrl"),
    updatedAt: vNum(d.fields, "updatedAt") ?? 0,
  }));
}

/** ★ RESTでピックアップ商品 N件（createdAt desc） */
async function fetchFeaturedProducts(
  siteId: string,
  categoryId: string,
  limit = 8
): Promise<Product[]> {
  const docs = await fsRunQuery({
    collection: "products",
    where: [
      { field: "siteId", value: siteId },
      { field: "categoryId", value: categoryId },
    ],
    orderBy: [{ field: "createdAt", direction: "DESCENDING" }],
    limit,
  });

  // 必要フィールドだけ埋めつつ Product 形に整形
  return docs.map((d) => {
    const f = d.fields;
    return {
      asin: docIdFromName(d.name),
      title: vStr(f, "title") ?? "",
      brand: vStr(f, "brand") ?? undefined,
      imageUrl: vStr(f, "imageUrl") ?? undefined,
      categoryId: vStr(f, "categoryId") ?? categoryId,
      siteId,
      tags: [],
      specs: undefined,
      offers: [], // トップでは未使用
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
    } satisfies Product;
  });
}

export default async function Page() {
  // getServerSide の site 情報（あなたの util に合わせて呼び出し）
  const { getServerSiteId, loadSiteConfig } = await import("@/lib/site-server");
  const siteId = getServerSiteId();
  const site = await loadSiteConfig(siteId).catch(() => ({
    displayName: "AffiScope",
    brand: { primary: "#16a34a", accent: "#0ea5e9", logoUrl: "" },
    categoryPreset: [] as string[],
  }));

  const firstCategory = site.categoryPreset?.[0];

  // ★ Web SDK ではなく REST で取得
  const featured: Product[] = firstCategory
    ? await fetchFeaturedProducts(siteId, firstCategory, 8)
    : [];

  const latestBlogs = await fetchLatestBlogs(siteId, 3);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* 以下はそのまま（省略） */}
      {/* ... */}
    </main>
  );
}
