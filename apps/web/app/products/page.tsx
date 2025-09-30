import type { Product } from "@affiscope/shared-types";
import { getServerSiteId } from "@/lib/site-server";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";
import ProductCard from "@/components/products/ProductCard";
import CategoryTabs, {
  type CategoryTab,
} from "@/components/categories/CategoryTabs";
import Link from "next/link";

export const revalidate = 60;
export const dynamic = "force-dynamic";

/** ===== utils ===== */
function timeago(ts?: number) {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

/** categories を siteId だけで取得 → 取得後に order で並べ替え（インデックス不要） */
async function fetchAllCategories(
  siteId: string
): Promise<(CategoryTab & { order: number })[]> {
  const docs = await fsRunQuery({
    collection: "categories",
    where: [{ field: "siteId", value: siteId }],
    limit: 200,
  }).catch(() => []);

  const rows = docs.map((d: any) => {
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

/** サイト設定（REST）— トップの実装と同等の軽量版 */
async function loadSiteConfigLocal(siteId: string): Promise<{
  siteId: string;
  displayName?: string;
  categoryPreset?: string[];
}> {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID!;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY!;
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sites/${encodeURIComponent(
      siteId
    )}`
  );
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch site failed: ${res.status}`);
  const json: any = await res.json();
  const fields = json.fields ?? {};
  const arr = (k: string) =>
    (fields?.[k]?.arrayValue?.values ?? []).map(
      (v: any) => v?.stringValue ?? ""
    );
  return {
    siteId,
    displayName: fields?.displayName?.stringValue,
    categoryPreset: arr("categoryPreset"),
  };
}

/** categoryId（= slug相当）で商品を取得。フォールバック付き */
async function fetchProductsByCategoryId(
  siteId: string,
  categoryId: string
): Promise<Product[]> {
  const run = async (withOrder: boolean) => {
    const base = {
      collection: "products",
      where: [
        { field: "siteId", value: siteId },
        { field: "categoryId", value: categoryId },
      ],
      limit: 200,
    };
    const q = withOrder
      ? {
          ...base,
          orderBy: [{ field: "createdAt", direction: "DESCENDING" as const }],
        }
      : base;

    const docs = await fsRunQuery(q).catch(() => []);
    return docs.map((d: any) => {
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
  };

  let rows = await run(true);
  if (rows.length === 0) rows = await run(false);
  if (rows.length === 0) {
    const docs = await fsRunQuery({
      collection: "products",
      where: [{ field: "siteId", value: siteId }],
      limit: 200,
    }).catch(() => []);
    rows = docs.map((d: any) => {
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
  const siteId = process.env.NEXT_PUBLIC_SITE_ID ?? getServerSiteId();
  const categorySlug = searchParams?.category ?? "gaming-chair";
  const sort: SortKey = (searchParams?.sort as SortKey) ?? "price_asc";
  const pricedOnly = searchParams?.priced === "1";

  // 1) カテゴリ
  let cats = await fetchAllCategories(siteId);
  if (cats.length === 0) {
    const site = await loadSiteConfigLocal(siteId).catch(() => null);
    const preset = site?.categoryPreset ?? [];
    cats = preset.map((slug) => ({ id: slug, name: slug, slug, order: 0 }));
  }
  if (cats.length === 0) {
    cats = [
      { id: categorySlug, name: categorySlug, slug: categorySlug, order: 0 },
    ];
  }

  // 2) 商品取得 → フィルター/並び替え（サーバー側で実施）
  let items = await fetchProductsByCategoryId(siteId, categorySlug);

  if (pricedOnly) {
    items = items.filter((p) => typeof p.bestPrice?.price === "number");
  }

  if (sort === "price_asc" || sort === "price_desc") {
    items.sort((a, b) => {
      const av = a.bestPrice?.price ?? Number.POSITIVE_INFINITY;
      const bv = b.bestPrice?.price ?? Number.POSITIVE_INFINITY;
      return sort === "price_asc" ? av - bv : bv - av;
    });
  } else if (sort === "newest") {
    items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  // 3) メタ情報（最終更新 = 一覧中の最大 updatedAt / bestPrice.updatedAt）
  const lastUpdated = items.reduce<number>((max, p) => {
    const u = p.bestPrice?.updatedAt ?? p.updatedAt ?? 0;
    return u > max ? u : max;
  }, 0);

  // 4) クエリリンク生成
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
      {/* breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
      </nav>

      {/* H1 */}
      <h1 className="mt-3 text-2xl font-bold">商品一覧（{categorySlug}）</h1>

      {/* カテゴリタブ */}
      <CategoryTabs
        categories={cats.map(({ id, name, slug }) => ({ id, name, slug }))}
        activeSlug={categorySlug}
      />

      {/* コントロールバー（信頼の見える化） */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="opacity-70">表示順:</span>
          <Link
            href={href({ sort: "price_asc" })}
            aria-current={sort === "price_asc" ? "page" : undefined}
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
            aria-current={sort === "price_desc" ? "page" : undefined}
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
            aria-current={sort === "newest" ? "page" : undefined}
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
          <span>データ元: Amazon</span>
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
