// apps/web/app/products/[asin]/page.tsx
import type { Product } from "@affiscope/shared-types";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getServerSiteId } from "@/lib/site-server";
import {
  fetchProductByAsin,
  fetchRelated,
  fetchBlogsByRelatedAsin,
  type MiniBlog,
} from "@/lib/queries";

export const revalidate = 60;
export const dynamic = "force-dynamic";

/* ---------- utils ---------- */
const jpy = (n?: number) =>
  typeof n === "number"
    ? new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
      }).format(n)
    : "";

const timeago = (ts?: number) => {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
};

const outUrl = (asin: string, url?: string, src: string = "detail") =>
  url
    ? `/out/${encodeURIComponent(asin)}?to=${encodeURIComponent(
        url
      )}&src=${src}`
    : undefined;

/* ---------- メタデータ（SEO） ---------- */
export async function generateMetadata({
  params,
}: {
  params: { asin: string };
}) {
  const siteId = process.env.NEXT_PUBLIC_SITE_ID ?? getServerSiteId();
  const p = await fetchProductByAsin(params.asin, siteId);
  if (!p) return { title: "商品が見つかりません" };
  const title = `${p.title}｜最安値・レビュー・スペック`;
  const description =
    p.aiSummary ??
    `${p.brand ?? ""} の ${p.title} の最安値と価格更新（${timeago(
      p.bestPrice?.updatedAt
    )}）を掲載。`;
  return { title, description };
}

/* ---------- ページ本体 ---------- */
export default async function ProductDetailPage({
  params,
}: {
  params: { asin: string };
}) {
  const siteId = process.env.NEXT_PUBLIC_SITE_ID ?? getServerSiteId();
  const asin = params.asin;

  const product = await fetchProductByAsin(asin, siteId);
  if (!product) return notFound();

  const related = await fetchRelated(
    siteId,
    product.categoryId,
    product.asin,
    8
  );
  const relatedBlogs: MiniBlog[] = await fetchBlogsByRelatedAsin(
    siteId,
    product.asin,
    6
  );

  const priceLabel =
    product.bestPrice?.source === "amazon"
      ? "Amazonで詳細を見る"
      : product.bestPrice?.source === "rakuten"
      ? "楽天で詳細を見る"
      : "詳細を見る";

  const dataSource =
    product.bestPrice?.source === "amazon"
      ? "Amazon"
      : product.bestPrice?.source === "rakuten"
      ? "楽天"
      : "—";

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.chairscope.com"
  ).replace(/\/$/, "");
  const canonical = `${siteUrl}/products/${product.asin}`;

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
        <span className="mx-2">/</span>
        <Link
          href={`/products?category=${encodeURIComponent(
            product.categoryId || "gaming-chair"
          )}`}
          className="underline"
        >
          商品一覧
        </Link>
        <span className="mx-2">/</span>
        <span className="opacity-70">{product.title}</span>
      </nav>

      {/* 構造化データ: BreadcrumbList */}
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
                item: siteUrl + "/",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "商品一覧",
                item: `${siteUrl}/products?category=${encodeURIComponent(
                  product.categoryId || "gaming-chair"
                )}`,
              },
              {
                "@type": "ListItem",
                position: 3,
                name: product.title,
                item: canonical,
              },
            ],
          }),
        }}
      />

      {/* ヘッダー */}
      <header className="mt-3 mb-4">
        <h1 className="text-2xl md:text-3xl font-bold">{product.title}</h1>
        <p className="text-sm opacity-70">{product.brand ?? "ブランド不明"}</p>
      </header>

      {/* 上段: 画像 + 価格/CTA */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-2">
          <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-gray-50">
            {product.imageUrl ? (
              <Image
                src={product.imageUrl}
                alt={product.title}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs text-gray-400">
                画像なし
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <div className="mb-2 text-sm text-gray-600 flex flex-wrap items-center gap-3">
            <span className="rounded bg-gray-100 px-2 py-0.5">
              データ元: {dataSource}
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5">
              最終更新:{" "}
              {timeago(product.bestPrice?.updatedAt ?? product.updatedAt)}
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5 opacity-80">
              本ページは広告を含みます
            </span>
          </div>

          <div className="text-3xl font-bold">
            {typeof product.bestPrice?.price === "number"
              ? jpy(product.bestPrice.price)
              : "価格を取得中です"}
          </div>

          <div className="mt-4 flex gap-3">
            {outUrl(product.asin, product.bestPrice?.url, "detail") ? (
              <a
                href={outUrl(product.asin, product.bestPrice?.url, "detail")}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="rounded-xl border px-5 py-2 font-medium hover:shadow-sm"
              >
                {priceLabel}
              </a>
            ) : (
              <span className="text-sm text-gray-500">リンク準備中</span>
            )}
            <a
              href="#specs"
              className="rounded-xl border px-4 py-2 text-sm hover:shadow-sm"
            >
              スペックを見る
            </a>
          </div>

          {product.aiSummary && (
            <p className="mt-4 text-sm leading-6 text-gray-700">
              {product.aiSummary}
            </p>
          )}

          {/* 悩みタグ */}
          {product.tags && product.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {product.tags.slice(0, 6).map((t) => (
                <Link
                  key={t}
                  href={`/pain/${encodeURIComponent(t)}`}
                  className="rounded-full border px-3 py-1 text-xs hover:shadow-sm"
                >
                  #{t}
                </Link>
              ))}
              <Link
                href={`/products?category=${encodeURIComponent(
                  product.categoryId || "gaming-chair"
                )}&priced=1`}
                className="rounded-full border px-3 py-1 text-xs opacity-80 hover:shadow-sm"
              >
                価格あり一覧へ
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* スペック（簡易） */}
      <section id="specs" className="mt-8 rounded-2xl border bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">主な仕様</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          <li className="flex justify-between border-b py-2">
            <span>ブランド</span>
            <span className="opacity-80">{product.brand ?? "—"}</span>
          </li>
          <li className="flex justify-between border-b py-2">
            <span>カテゴリ</span>
            <span className="opacity-80">{product.categoryId || "—"}</span>
          </li>
          <li className="flex justify-between border-b py-2">
            <span>作成日時</span>
            <span className="opacity-80">
              {new Date(product.createdAt || 0).toLocaleDateString("ja-JP")}
            </span>
          </li>
          <li className="flex justify-between border-b py-2">
            <span>最終更新</span>
            <span className="opacity-80">{timeago(product.updatedAt)}</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          ※ 仕様は自動取得につき誤差がある場合があります。
        </p>
      </section>

      {/* この商品の解決ガイド */}
      {relatedBlogs.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">この商品の解決ガイド</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {relatedBlogs.map((b) => (
              <li
                key={b.slug}
                className="rounded-xl border p-3 hover:shadow-sm transition"
              >
                <Link href={`/blog/${b.slug}`} className="block">
                  <div className="font-medium line-clamp-2">{b.title}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    公開:{" "}
                    {new Date(
                      b.publishedAt ?? b.updatedAt ?? 0
                    ).toLocaleDateString("ja-JP")}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 関連商品 */}
      {related.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">関連商品</h2>
            <Link
              href={`/products?category=${encodeURIComponent(
                product.categoryId || "gaming-chair"
              )}`}
              className="text-sm underline"
            >
              一覧へ戻る
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((p) => (
              <li
                key={p.asin}
                className="overflow-hidden rounded-2xl border bg-white transition hover:shadow-sm"
              >
                <Link href={`/products/${p.asin}`} className="block p-3">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* JSON-LD: Product（既存＋canonicalリンク） */}
      <link rel="canonical" href={canonical} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.title,
            brand: product.brand
              ? { "@type": "Brand", name: product.brand }
              : undefined,
            image: product.imageUrl,
            sku: product.asin,
            url: canonical,
            offers: product.bestPrice
              ? {
                  "@type": "Offer",
                  priceCurrency: "JPY",
                  price: product.bestPrice.price,
                  url: product.bestPrice.url,
                  availability: "http://schema.org/InStock",
                  priceValidUntil: new Date(
                    Date.now() + 1000 * 60 * 60 * 24 * 14
                  ).toISOString(),
                }
              : undefined,
          }),
        }}
      />

      {/* mobile sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70 p-3 md:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="text-lg font-semibold">
            {typeof product.bestPrice?.price === "number"
              ? jpy(product.bestPrice.price)
              : "価格取得中"}
            <span className="ml-2 text-xs text-gray-600">
              {timeago(product.bestPrice?.updatedAt ?? product.updatedAt)}
            </span>
          </div>
          {outUrl(product.asin, product.bestPrice?.url, "sticky") ? (
            <a
              href={outUrl(product.asin, product.bestPrice?.url, "sticky")}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="rounded-xl border px-4 py-2 font-medium"
            >
              {priceLabel}
            </a>
          ) : (
            <span className="text-sm text-gray-500">リンク準備中</span>
          )}
        </div>
      </div>
    </main>
  );
}
