// apps/web/app/products/page.tsx
import type { Product, OfferSource } from "@affiscope/shared-types";
import Link from "next/link";
import ProductCard from "@/components/products/ProductCard";
import {
  fsRunQuery,
  fsGetString as vStr,
  fsGetNumber as vNum,
  fsGetStringArray as vStrArr,
  fsGetBoolean as vBool,
  docIdFromName,
} from "@/lib/firestore-rest";
import { getSiteEntry } from "@/lib/site-server";
import { getSiteConfig } from "@/lib/site-config";

export const revalidate = 60;
export const dynamic = "force-dynamic";

type FsQueryArg = {
  projectId?: string;
  apiKey?: string;
  collection: string;
  where?: {
    field: string;
    op?:
      | "EQUAL"
      | "GREATER_THAN"
      | "LESS_THAN"
      | "GREATER_THAN_OR_EQUAL"
      | "LESS_THAN_OR_EQUAL";
    value: string | number | boolean | null;
  }[];
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" }[];
  limit?: number;
};

function timeago(ts?: number) {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(s / 60 / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

async function fetchAllCategories(siteId: string) {
  const docs = await fsRunQuery({
    collection: "categories",
    where: [{ field: "siteId", value: siteId }],
    limit: 200,
  }).catch(() => []);
  const rows = docs.map((d) => {
    const f = d.fields;
    return {
      id: docIdFromName(d.name),
      name: vStr(f, "name") ?? "",
      slug: vStr(f, "slug") ?? "",
      order: vNum(f, "order") ?? 0,
    };
  });
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

async function fetchProductsByCategoryId(
  siteId: string,
  categoryId: string
): Promise<Product[]> {
  const run = async (withOrder: boolean) => {
    // ★ readonly 推論を避けるため "as const" は使わない
    const base: FsQueryArg = {
      collection: "products",
      where: [
        { field: "siteId", value: siteId },
        { field: "categoryId", value: categoryId },
      ],
      limit: 200,
    };

    const q: FsQueryArg = withOrder
      ? {
          ...base,
          orderBy: [{ field: "createdAt", direction: "DESCENDING" }],
        }
      : base;

    const docs = await fsRunQuery(q).catch(() => []);
    return docs.map((d) => {
      const f = d.fields;
      const bpPrice = vNum(f, "bestPrice.price");
      const bpUrl = vStr(f, "bestPrice.url");
      const bpSource = vStr(f, "bestPrice.source") as OfferSource | undefined;
      const bpUpdatedAt = vNum(f, "bestPrice.updatedAt");

      const p: Product = {
        asin: docIdFromName(d.name),
        title: vStr(f, "title") ?? "",
        brand: vStr(f, "brand") ?? undefined,
        imageUrl: vStr(f, "imageUrl") ?? undefined,
        categoryId: vStr(f, "categoryId") ?? categoryId,
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
        bestPrice:
          typeof bpPrice === "number" &&
          typeof bpUpdatedAt === "number" &&
          bpUrl &&
          bpSource
            ? {
                price: bpPrice,
                url: bpUrl,
                source: bpSource,
                updatedAt: bpUpdatedAt,
              }
            : undefined,
        priceHistory: [],
        aiSummary: vStr(f, "aiSummary") ?? undefined,
        views: vNum(f, "views") ?? 0,
        createdAt: vNum(f, "createdAt") ?? 0,
        updatedAt: vNum(f, "updatedAt") ?? 0,
      };
      return p;
    });
  };

  let rows = await run(true);
  if (rows.length === 0) rows = await run(false);
  if (rows.length === 0) {
    const docs = await fsRunQuery({
      collection: "products",
      where: [{ field: "siteId", value: siteId }],
      limit: 200,
    }).catch(() => []);
    rows = docs.map((d) => {
      const f = d.fields;
      return {
        asin: docIdFromName(d.name),
        title: vStr(f, "title") ?? "",
        brand: vStr(f, "brand") ?? undefined,
        imageUrl: vStr(f, "imageUrl") ?? undefined,
        categoryId: vStr(f, "categoryId") ?? "",
        siteId,
        tags: vStrArr(f, "tags") ?? [],
        offers: [],
        bestPrice: undefined,
        priceHistory: [],
        createdAt: vNum(f, "createdAt") ?? 0,
        updatedAt: vNum(f, "updatedAt") ?? 0,
      } as Product;
    });
  }
  return rows;
}

type SortKey = "price_asc" | "price_desc" | "newest";
type SP = { category?: string; sort?: SortKey; priced?: string };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: SP;
}) {
  const s = getSiteEntry(); // siteId / categoryPreset / domain
  const cfg = getSiteConfig(); // urlOrigin など（構造化データ用）

  // 1) カテゴリ一覧
  let cats = await fetchAllCategories(s.siteId);

  // 2) デフォルトカテゴリ（クエリ > preset[0] > Firestore先頭 > “default”）
  const presetFirst = s.categoryPreset?.[0];
  const categorySlug =
    searchParams?.category ??
    presetFirst ??
    (cats[0]?.slug || cats[0]?.id) ??
    "default";

  const sort: SortKey = (searchParams?.sort as SortKey) ?? "price_asc";
  const pricedOnly = searchParams?.priced === "1";

  if (cats.length === 0) {
    cats = [
      { id: categorySlug, name: categorySlug, slug: categorySlug, order: 0 },
    ];
  }

  // 3) 商品取得
  let items = await fetchProductsByCategoryId(s.siteId, categorySlug);

  if (pricedOnly)
    items = items.filter((p) => typeof p.bestPrice?.price === "number");

  if (sort === "price_asc" || sort === "price_desc") {
    items.sort((a, b) => {
      const av = a.bestPrice?.price ?? Number.POSITIVE_INFINITY;
      const bv = b.bestPrice?.price ?? Number.POSITIVE_INFINITY;
      return sort === "price_asc" ? av - bv : bv - av;
    });
  } else if (sort === "newest") {
    items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  const lastUpdated = items.reduce<number>((max, p) => {
    const u = p.bestPrice?.updatedAt ?? p.updatedAt ?? 0;
    return u > max ? u : max;
  }, 0);

  const href = (next: Partial<SP>) => {
    const params = new URLSearchParams();
    params.set("category", next.category ?? categorySlug);
    params.set("sort", (next.sort ?? sort) as string);
    if ((next.priced ?? (pricedOnly ? "1" : "")) === "1")
      params.set("priced", "1");
    return `/products?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* パンくず */}
      <nav className="mb-2 text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
        <span className="mx-2">/</span>
        <span className="opacity-70">商品一覧</span>
      </nav>

      {/* 構造化データ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "ホーム",
                item: `${cfg.urlOrigin}/`,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "商品一覧",
                item: `${cfg.urlOrigin}/products?category=${encodeURIComponent(
                  categorySlug
                )}`,
              },
            ],
          }),
        }}
      />

      <nav className="text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
      </nav>

      <h1 className="mt-3 text-2xl font-bold">商品一覧（{categorySlug}）</h1>

      {/* コントロールバー */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="opacity-70">表示順:</span>
          <Link
            href={href({ sort: "price_asc" })}
            className={`rounded px-2 py-1 ${
              sort === "price_asc"
                ? "bg-gray-100 font-medium"
                : "hover:underline"
            }`}
          >
            価格の安い順
          </Link>
          <Link
            href={href({ sort: "price_desc" })}
            className={`rounded px-2 py-1 ${
              sort === "price_desc"
                ? "bg-gray-100 font-medium"
                : "hover:underline"
            }`}
          >
            価格の高い順
          </Link>
          <Link
            href={href({ sort: "newest" })}
            className={`rounded px-2 py-1 ${
              sort === "newest" ? "bg-gray-100 font-medium" : "hover:underline"
            }`}
          >
            新着順
          </Link>
        </div>

        <div className="mx-2 h-4 w-px bg-gray-200" />

        <div className="flex items-center gap-2">
          <span className="opacity-70">フィルター:</span>
          <Link
            href={href({ priced: pricedOnly ? "" : "1" })}
            className={`rounded px-2 py-1 ${
              pricedOnly ? "bg-gray-100 font-medium" : "hover:underline"
            }`}
          >
            価格ありのみ
          </Link>
          <span className="opacity-60">（{items.length}件）</span>
        </div>

        <div className="mx-2 h-4 w-px bg-gray-200" />

        <div className="flex items-center gap-2 opacity-80">
          <span>最終更新: {timeago(lastUpdated)}</span>
          <span className="opacity-70">※本ページは広告を含みます</span>
        </div>
      </div>

      {/* リスト */}
      {items.length === 0 ? (
        <p className="mt-4 text-gray-500">該当商品がありません。</p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <ProductCard key={p.asin} p={p} />
          ))}
        </ul>
      )}
    </main>
  );
}
