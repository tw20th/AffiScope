import type { Product } from "@affiscope/shared-types";
import { getServerSiteId } from "@/lib/site-server";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";
import ProductCard from "@/components/products/ProductCard";
import CategoryTabs, {
  type CategoryTab,
} from "@/components/categories/CategoryTabs";

export const revalidate = 60;
export const dynamic = "force-dynamic";

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

/** サイト設定（REST）— page.tsx と同じローカル実装 */
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
      limit: 100,
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
      limit: 100,
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

  rows.sort(
    (a, b) =>
      (a.bestPrice?.price ?? Number.POSITIVE_INFINITY) -
      (b.bestPrice?.price ?? Number.POSITIVE_INFINITY)
  );
  return rows;
}

type SP = { category?: string };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: SP;
}) {
  const siteId = process.env.NEXT_PUBLIC_SITE_ID ?? getServerSiteId();
  const categorySlug = searchParams?.category ?? "gaming-chair";

  // 1) Firestoreからカテゴリ
  let cats = await fetchAllCategories(siteId);

  // 2) 取れなければサイト設定の categoryPreset をフォールバックに
  if (cats.length === 0) {
    const site = await loadSiteConfigLocal(siteId).catch(() => null);
    const preset = site?.categoryPreset ?? [];
    cats = preset.map((slug) => ({
      id: slug,
      name: slug, // 表示名未設定ならとりあえず slug
      slug,
      order: 0,
    }));
  }

  // 3) さらに何もなければ「現在のカテゴリだけ」をタブ表示
  if (cats.length === 0) {
    cats = [
      { id: categorySlug, name: categorySlug, slug: categorySlug, order: 0 },
    ];
  }

  const items = await fetchProductsByCategoryId(siteId, categorySlug);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <nav className="text-sm text-gray-500">
        <a href="/products" className="underline">
          ホーム
        </a>
      </nav>

      <h1 className="mt-3 text-2xl font-bold">商品一覧（{categorySlug}）</h1>

      {/* カテゴリタブ（必ず何かしら出る） */}
      <CategoryTabs
        categories={cats.map(({ id, name, slug }) => ({ id, name, slug }))}
        activeSlug={categorySlug}
      />

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
