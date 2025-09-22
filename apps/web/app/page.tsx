// apps/web/app/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getServerSiteId, loadSiteConfig } from "@/lib/site-server";
import { fetchProducts } from "@/lib/products";
import type { Product } from "@affiscope/shared-types";

export const revalidate = 60;

function jpy(n?: number) {
  if (typeof n !== "number") return "";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
  }).format(n);
}

export default async function Page() {
  const siteId = getServerSiteId();
  const site = await loadSiteConfig(siteId).catch(() => ({
    displayName: "AffiScope",
    brand: { primary: "#16a34a", accent: "#0ea5e9", logoUrl: "" },
    categoryPreset: [] as string[],
  }));

  const firstCategory = site.categoryPreset?.[0];
  const featured: Product[] = firstCategory
    ? (
        await fetchProducts({
          siteId,
          categoryId: firstCategory,
          sortBy: "createdAt",
          order: "desc",
          pageSize: 8,
        })
      ).items
    : [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* HERO */}
      <section className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {site.brand?.logoUrl ? (
          <div className="relative h-14 w-40">
            <Image
              src={site.brand.logoUrl}
              alt={site.displayName ?? "Site"}
              fill
              sizes="160px"
              className="object-contain"
              priority
            />
          </div>
        ) : null}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {site.displayName ?? "AffiScope"}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            テスト表示中：siteId=<span className="font-mono">{siteId}</span>
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={
                firstCategory
                  ? `/products?category=${firstCategory}`
                  : "/products"
              }
              className="rounded-xl bg-black px-4 py-2 text-white hover:opacity-90"
              style={{ background: site.brand?.primary ?? undefined }}
            >
              {firstCategory ? "商品一覧へ" : "全カテゴリを見る"}
            </Link>
            <Link
              href="/products"
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
            >
              すべてのカテゴリ
            </Link>
          </div>
        </div>
      </section>

      {/* カテゴリのショートカット */}
      {site.categoryPreset?.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">カテゴリ</h2>
          <div className="flex flex-wrap gap-3">
            {site.categoryPreset.map((cid: string) => (
              <Link
                key={cid}
                href={`/products?category=${cid}`}
                className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
              >
                {cid}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* 新着 / ピックアップ */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {firstCategory ? `新着（${firstCategory}）` : "新着"}
          </h2>
          {firstCategory ? (
            <Link
              href={`/products?category=${firstCategory}`}
              className="text-sm text-blue-600 hover:underline"
            >
              もっと見る
            </Link>
          ) : null}
        </div>

        {featured.length === 0 ? (
          <p className="text-sm text-gray-500">
            まだ商品がありません。ASIN を投入してみてください。
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p: Product) => (
              <li key={p.asin} className="rounded-2xl border p-3">
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-gray-50">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={p.title ?? p.asin}
                      width={480}
                      height={360}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="line-clamp-2 text-sm font-medium">
                    {p.title ?? p.asin}
                  </div>
                  {p.brand ? (
                    <div className="text-xs text-gray-500">{p.brand}</div>
                  ) : null}
                  <div className="text-base font-semibold">
                    {jpy(p.bestPrice?.price)}{" "}
                    <span className="ml-1 text-xs text-gray-500">Amazon</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dev helpers */}
      <section className="mt-12 rounded-2xl border p-4">
        <div className="text-sm text-gray-600">
          <p>
            開発用：
            <code className="rounded bg-gray-100 px-1 py-0.5">
              ?site=chairscope
            </code>{" "}
            で切替可。
          </p>
        </div>
      </section>
    </main>
  );
}
