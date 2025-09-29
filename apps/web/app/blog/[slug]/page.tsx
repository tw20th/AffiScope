// apps/web/app/blog/[slug]/page.tsx
import { notFound } from "next/navigation";
import { getServerSiteId } from "@/lib/site-server";
import { fsGet, vNum, vStr } from "@/lib/firestore-rest";

export const revalidate = 3600; // 1時間
export const dynamic = "force-dynamic"; // ← ビルド時の実アクセスを避ける（ISRを使いたいなら削ってOK）

type Blog = {
  slug: string;
  title: string;
  content: string;
  imageUrl?: string;
  summary?: string;
  siteId: string;
  updatedAt: number;
};

/** content から簡易サマリーを生成（記号除去して最大120文字） */
function makeSummaryFromContent(md: string, max = 120) {
  const plain = md
    .replace(/^#{1,6}\s+/gm, "") // 見出しの # を除去
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1") // リンクはテキストに
    .replace(/[*_`>~-]/g, " ") // 装飾系記号をざっくり除去
    .replace(/\s+/g, " ") // 連続空白を1つに
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

async function fetchBlog(slug: string): Promise<Blog | null> {
  const doc = await fsGet({ path: `blogs/${slug}` });
  if (!doc) return null;

  const f = doc.fields;
  const content = vStr(f, "content") ?? "";
  const summary = vStr(f, "summary") || makeSummaryFromContent(content);

  return {
    slug,
    title: vStr(f, "title") ?? "(no title)",
    content,
    imageUrl: vStr(f, "imageUrl"),
    summary,
    siteId: vStr(f, "siteId") ?? "",
    updatedAt: vNum(f, "updatedAt") ?? 0,
  };
}

export default async function BlogDetail({
  params,
}: {
  params: { slug: string };
}) {
  const siteId = getServerSiteId();

  let blog: Blog | null = null;
  try {
    blog = await fetchBlog(params.slug);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    // 公開されていない記事などの 403 は 404 にフォールバック
    if (msg.includes("fsGet failed: 403")) {
      notFound();
    }
    throw e;
  }

  if (!blog || blog.siteId !== siteId) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold">{blog.title}</h1>
      <div className="mt-2 text-xs text-gray-500">
        {blog.updatedAt ? new Date(blog.updatedAt).toLocaleString("ja-JP") : ""}
      </div>

      {/* サマリー（ある場合だけ表示） */}
      {blog.summary && (
        <p className="mt-4 text-sm text-gray-700">{blog.summary}</p>
      )}

      <article className="prose prose-neutral mt-6 max-w-none">
        {/* 本番では Markdown → HTML 変換に置き換え予定 */}
        <pre className="whitespace-pre-wrap">{blog.content}</pre>
      </article>
    </main>
  );
}
