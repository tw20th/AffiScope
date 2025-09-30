import type { Product } from "@affiscope/shared-types";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";
import { getServerSiteId } from "@/lib/site-server";
import ProductCard from "@/components/products/ProductCard";
import Image from "next/image";

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

/* ---------- Firestore REST: 単一ドキュメント取得（docId=ASIN前提） ---------- */
async function fetchProductByAsin(
  asin: string,
  siteId: string
): Promise<Product | null> {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY;
  if (!projectId || !apiKey) return null;

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products/${encodeURIComponent(
      asin
    )}`
  );
  url.searchParams.set("key", String(apiKey));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const d: any = await res.json();
  const f = d.fields ?? {};
  const valStr = (k: string) => f?.[k]?.stringValue as string | undefined;
  const valNum = (k: string) =>
    (typeof f?.[k]?.integerValue === "string"
      ? Number(f?.[k]?.integerValue)
      : f?.[k]?.doubleValue ?? f?.[k]?.numberValue) as number | undefined;

  const bestPrice = (() => {
    const price = valNum("bestPrice.price");
    const url = valStr("bestPrice.url");
    const source = valStr("bestPrice.source") as
      | "amazon"
      | "rakuten"
      | undefined;
    const updatedAt = valNum("bestPrice.updatedAt");
    return typeof price === "number" &&
      url &&
      source &&
      typeof updatedAt === "number"
      ? { price, url, source, updatedAt }
      : undefined;
  })();

  return {
    asin,
    title: valStr("title") ?? "",
    brand: valStr("brand") ?? undefined,
    imageUrl: valStr("imageUrl") ?? undefined,
    categoryId: valStr("categoryId") ?? "",
    siteId,
    tags: [], // 必要なら配列展開を後で追加
    specs: undefined, // 同上
    offers: [],
    bestPrice,
    priceHistory: [],
    aiSummary: valStr("aiSummary") ?? undefined,
    views: valNum("views") ?? 0,
    createdAt: valNum("createdAt") ?? 0,
    updatedAt: valNum("updatedAt") ?? 0,
  };
}

/* ---------- 関連商品（同カテゴリの新着） ---------- */
async function fetchRelated(
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
      </nav>

      {/* ヘッダー */}
      <header className="mt-3 mb-4">
        <h1 className="text-2xl md:text-3xl font-bold">{product.title}</h1>
        <p className="text-sm opacity-70">{product.brand ?? "ブランド不明"}</p>
      </header>

      {/* 上段: 画像 + 価格/CTA */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-2">
          <div className="relative aspect-[4/3] bg-gray-50 rounded-xl overflow-hidden">
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
            {product.bestPrice?.url ? (
              <a
                href={product.bestPrice.url}
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
              <ProductCard key={p.asin} p={p} />
            ))}
          </ul>
        </section>
      )}

      {/* JSON-LD（SEO） */}
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
            url: `${
              process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.chairscope.com"
            }/products/${product.asin}`,
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
    </main>
  );
}
