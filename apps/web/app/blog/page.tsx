import Link from "next/link";
import BlogCard from "@/components/blog/BlogCard";
import { getServerSiteId } from "@/lib/site-server";
import { fetchBlogs, type BlogRow } from "@/lib/queries";

import PainRail from "@/components/pain/PainRail";
import { loadPainRules } from "@/lib/pain-helpers";

export const revalidate = 1800;
export const dynamic = "force-dynamic";

type SortKey = "recent" | "popular";
type BlogType = "all" | "pricedrop" | "review" | "comparison";
type SP = { sort?: SortKey; type?: BlogType };

function formatJp(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classify(b: BlogRow): "pricedrop" | "review" | "comparison" {
  const t = (b.title ?? "").toLowerCase();
  if (t.includes("値下げ")) return "pricedrop";
  if (t.includes("レビュー")) return "review";
  return "comparison";
}

export async function generateMetadata() {
  return {
    title: "ブログ｜値下げ情報・レビューまとめ",
    description:
      "最新の値下げ情報やレビュー記事を公開日順で表示。価格ソースと公開日時を明記しています。",
  };
}

export default async function BlogIndex({
  searchParams,
}: {
  searchParams?: SP;
}) {
  const siteId = getServerSiteId();
  const painRules = await loadPainRules(siteId);

  const sort: SortKey = (searchParams?.sort as SortKey) ?? "recent";
  const type: BlogType = (searchParams?.type as BlogType) ?? "all";

  const orderBy =
    sort === "popular"
      ? [{ field: "views", direction: "DESCENDING" as const }]
      : [{ field: "publishedAt", direction: "DESCENDING" as const }];
  const blogs = await fetchBlogs(siteId, orderBy, 40);

  const filtered =
    type === "all" ? blogs : blogs.filter((b) => classify(b) === type);

  const lastPub = filtered.reduce<number>(
    (max, b) => Math.max(max, b.publishedAt ?? b.updatedAt ?? 0),
    0
  );

  const href = (next: Partial<SP>) => {
    const params = new URLSearchParams();
    params.set("sort", (next.sort ?? sort) as string);
    params.set("type", (next.type ?? type) as string);
    return `/blog?${params.toString()}`;
  };

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.chairscope.com"
  ).replace(/\/$/, "");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
        <span className="mx-2">/</span>
        <span className="opacity-70">ブログ</span>
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
                name: "ブログ",
                item: `${siteUrl}/blog`,
              },
            ],
          }),
        }}
      />

      <h1 className="mt-3 text-2xl font-bold">ブログ</h1>

      {/* コントロール */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="opacity-70">表示順:</span>
          <Link
            href={href({ sort: "recent" })}
            aria-current={sort === "recent" ? "page" : undefined}
            className={`rounded px-2 py-1 ${
              sort === "recent" ? "bg-gray-100 font-medium" : "hover:underline"
            }`}
          >
            公開日が新しい順
          </Link>
          <Link
            href={href({ sort: "popular" })}
            aria-current={sort === "popular" ? "page" : undefined}
            className={`rounded px-2 py-1 ${
              sort === "popular" ? "bg-gray-100 font-medium" : "hover:underline"
            }`}
          >
            人気順
          </Link>
        </div>

        <div className="mx-2 h-4 w-px bg-gray-200" />

        <div className="flex items-center gap-2">
          <span className="opacity-70">記事タイプ:</span>
          {(["all", "pricedrop", "review", "comparison"] as const).map((t) => (
            <Link
              key={t}
              href={href({ type: t })}
              aria-current={type === t ? "page" : undefined}
              className={`rounded px-2 py-1 ${
                type === t ? "bg-gray-100 font-medium" : "hover:underline"
              }`}
            >
              {t === "all"
                ? "すべて"
                : t === "pricedrop"
                ? "値下げ"
                : t === "review"
                ? "レビュー"
                : "比較/ガイド"}
            </Link>
          ))}
        </div>

        <div className="mx-2 h-4 w-px bg-gray-200" />
        <div className="opacity-80">記事数: {filtered.length}件</div>
        <div className="mx-2 h-4 w-px bg-gray-200" />
        <div className="opacity-80">最終公開: {formatJp(lastPub)}</div>
      </div>

      {/* サブ導線：悩みから探す */}
      <PainRail className="my-10" />

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          公開済みの記事がまだありません。
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((b) => (
            <BlogCard
              key={b.slug}
              slug={b.slug}
              title={b.title}
              summary={b.summary}
              content={(b as any).content ?? undefined}
              imageUrl={b.imageUrl}
              imageCredit={(b as any).imageCredit ?? null}
              imageCreditLink={(b as any).imageCreditLink ?? null}
              publishedAt={b.publishedAt}
              updatedAt={b.updatedAt}
            />
          ))}
        </ul>
      )}

      <div className="mt-8 text-sm text-gray-600">
        <Link href="/products" className="underline">
          商品一覧
        </Link>{" "}
        もどうぞ。値下げがあればブログでお知らせします。
      </div>
    </main>
  );
}
