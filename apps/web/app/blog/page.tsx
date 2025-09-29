// apps/web/app/blog/page.tsx
// 一覧
import BlogCard from "@/components/blog/BlogCard";
import { getServerSiteId } from "@/lib/site-server";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";

export const revalidate = 1800; // 30分
export const dynamic = "force-dynamic"; // ← ビルド時の実アクセスを避ける（ISRを使いたいなら削ってOK）

type Blog = {
  slug: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  imageUrl?: string | null;
  updatedAt: number;
};

async function fetchBlogs(siteId: string, limit = 20): Promise<Blog[]> {
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
    summary: vStr(d.fields, "summary") ?? null,
    content: vStr(d.fields, "content") ?? null, // フォールバック用
    imageUrl: vStr(d.fields, "imageUrl") ?? null,
    updatedAt: vNum(d.fields, "updatedAt") ?? 0,
  }));
}

export default async function BlogIndex() {
  const siteId = getServerSiteId();
  const blogs = await fetchBlogs(siteId, 20);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">ブログ</h1>
      {blogs.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          公開済みの記事がまだありません。
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {blogs.map((b) => (
            <BlogCard key={b.slug} {...b} />
          ))}
        </ul>
      )}
    </main>
  );
}
