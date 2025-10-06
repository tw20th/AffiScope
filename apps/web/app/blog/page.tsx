import Link from "next/link";
import BlogCard from "@/components/blog/BlogCard";
import { getServerSiteId } from "@/lib/site-server";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";

export const revalidate = 1800; // 30分
export const dynamic = "force-dynamic";

type Blog = {
  slug: string;
  title: string;
  summary?: string | null;
  imageUrl?: string | null;
  publishedAt?: number;
  updatedAt?: number;
  views?: number;
};

type SortKey = "recent" | "popular";
type SP = { sort?: SortKey };

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

async function fetchBlogs(
  siteId: string,
  sort: SortKey,
  take = 40
): Promise<Blog[]> {
  try {
    const orderBy =
      sort === "popular"
        ? [{ field: "views", direction: "DESCENDING" as const }]
        : [{ field: "publishedAt", direction: "DESCENDING" as const }];

    const docs = await fsRunQuery({
      collection: "blogs",
      where: [
        { field: "status", value: "published" },
        { field: "siteId", value: siteId },
      ],
      orderBy,
      limit: take,
    });

    return docs.map((d) => ({
      slug: docIdFromName(d.name),
      title: vStr(d.fields, "title") ?? "(no title)",
      summary: vStr(d.fields, "summary") ?? null,
      imageUrl: vStr(d.fields, "imageUrl") ?? null,
      publishedAt: vNum(d.fields, "publishedAt") ?? undefined,
      updatedAt: vNum(d.fields, "updatedAt") ?? undefined,
      views: vNum(d.fields, "views") ?? 0,
    }));
  } catch {
    const docs = await fsRunQuery({
      collection: "blogs",
      where: [
        { field: "status", value: "published" },
        { field: "siteId", value: siteId },
      ],
      limit: take,
    }).catch(() => []);

    const rows: Blog[] = docs.map((d) => ({
      slug: docIdFromName(d.name),
      title: vStr(d.fields, "title") ?? "(no title)",
      summary: vStr(d.fields, "summary") ?? null,
      imageUrl: vStr(d.fields, "imageUrl") ?? null,
      publishedAt: vNum(d.fields, "publishedAt") ?? undefined,
      updatedAt: vNum(d.fields, "updatedAt") ?? undefined,
      views: vNum(d.fields, "views") ?? 0,
    }));

    rows.sort((a, b) =>
      sort === "popular"
        ? (b.views ?? 0) - (a.views ?? 0)
        : (b.publishedAt ?? b.updatedAt ?? 0) -
          (a.publishedAt ?? a.updatedAt ?? 0)
    );
    return rows;
  }
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
  const sort: SortKey = (searchParams?.sort as SortKey) ?? "recent";

  const blogs = await fetchBlogs(siteId, sort, 40);
  const lastPub = blogs.reduce<number>(
    (max, b) => Math.max(max, b.publishedAt ?? b.updatedAt ?? 0),
    0
  );

  const href = (next: Partial<SP>) => {
    const params = new URLSearchParams();
    params.set("sort", (next.sort ?? sort) as string);
    return `/blog?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">ブログ</h1>
      <p className="mt-1 text-xs text-gray-500">debug: siteId = {siteId}</p>

      {/* メタ情報＆コントロール */}
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
        <div className="opacity-80">記事数: {blogs.length}件</div>
        <div className="mx-2 h-4 w-px bg-gray-200" />
        <div className="opacity-80">最終公開: {formatJp(lastPub)}</div>
      </div>

      {blogs.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          公開済みの記事がまだありません。
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {blogs.map((b) => (
            <BlogCard
              key={b.slug}
              slug={b.slug}
              title={b.title}
              summary={b.summary}
              imageUrl={b.imageUrl}
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
