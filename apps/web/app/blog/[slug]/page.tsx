// apps/web/app/blog/[slug]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSiteId } from "@/lib/site-server";
import { fsGet, vNum, vStr } from "@/lib/firestore-rest";

export const revalidate = 3600; // 1時間
export const dynamic = "force-dynamic";

type Blog = {
  slug: string;
  title: string;
  content: string;
  imageUrl?: string;
  summary?: string;
  siteId: string;
  updatedAt?: number;
  publishedAt?: number;
  relatedAsin?: string | null;
};

type BestPrice = {
  price: number;
  url: string;
  source: "amazon" | "rakuten";
  updatedAt: number;
};

// ---- utils ----
const fmt = (ts?: number) =>
  ts
    ? new Date(ts).toLocaleString("ja-JP", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

function makeSummaryFromContent(md: string, max = 120) {
  const plain = md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`>~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

// 依存なしの軽量 Markdown -> HTML（必要最小限）
function mdToHtml(md: string) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fences: string[] = [];
  md = md.replace(/```([\s\S]*?)```/g, (_, code) => {
    fences.push(
      `<pre class="not-prose overflow-x-auto"><code>${esc(
        code.trim()
      )}</code></pre>`
    );
    return `[[[FENCE_${fences.length - 1}]]]`;
  });

  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let ulOpen = false;

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\u3000-\u9fff-]+/g, " ")
      .trim()
      .replace(/\s+/g, "-");

  for (const raw of lines) {
    const line = raw.trimEnd();

    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (ulOpen) {
        out.push("</ul>");
        ulOpen = false;
      }
      const level = m[1].length;
      const text = m[2].trim();
      const id = slugify(text);
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const item = line.replace(/^[-*]\s+/, "");
      if (!ulOpen) {
        out.push('<ul class="list-disc pl-6">');
        ulOpen = true;
      }
      out.push(`<li>${item}</li>`);
      continue;
    } else if (ulOpen && line === "") {
      out.push("</ul>");
      ulOpen = false;
    }

    if (line === "") {
      out.push("");
      continue;
    }

    let html = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(
        /\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener nofollow sponsored" class="underline">$1</a>'
      );

    out.push(`<p>${html}</p>`);
  }
  if (ulOpen) out.push("</ul>");

  let html = out.join("\n");
  html = html.replace(
    /\[\[\[FENCE_(\d+)]]]/g,
    (_, i) => fences[Number(i)] || ""
  );
  return html;
}

// 目次抽出（## と ###）
function extractToc(md: string) {
  const lines = md.split(/\r?\n/);
  const items: { level: 2 | 3; text: string; id: string }[] = [];
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\u3000-\u9fff-]+/g, " ")
      .trim()
      .replace(/\s+/g, "-");
  for (const l of lines) {
    const m = l.match(/^(#{2,3})\s+(.*)$/);
    if (m) {
      const level = m[1].length === 2 ? 2 : 3;
      const text = m[2].trim();
      items.push({ level, text, id: slugify(text) });
    }
  }
  return items;
}

// ---- data access ----
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
    imageUrl: vStr(f, "imageUrl") ?? undefined,
    summary,
    siteId: vStr(f, "siteId") ?? "",
    updatedAt: vNum(f, "updatedAt") ?? undefined,
    publishedAt: vNum(f, "publishedAt") ?? undefined,
    relatedAsin: vStr(f, "relatedAsin") ?? null,
  };
}

async function fetchBestPrice(asin: string): Promise<BestPrice | null> {
  const doc = await fsGet({ path: `products/${asin}` }).catch(() => null);
  const f = (doc as any)?.fields;
  if (!f) return null;
  const price = vNum(f, "bestPrice.price");
  const url = vStr(f, "bestPrice.url");
  const source = vStr(f, "bestPrice.source") as
    | "amazon"
    | "rakuten"
    | undefined;
  const updatedAt = vNum(f, "bestPrice.updatedAt");
  if (
    typeof price === "number" &&
    url &&
    source &&
    typeof updatedAt === "number"
  ) {
    return { price, url, source, updatedAt };
  }
  return null;
}

// ---- SEO ----
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}) {
  const blog = await fetchBlog(params.slug).catch(() => null);
  if (!blog) return { title: "記事が見つかりません" };
  const title = `${blog.title}｜値下げ情報・レビュー`;
  const description = blog.summary ?? makeSummaryFromContent(blog.content);
  return { title, description };
}

// ---- page ----
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
    if (msg.includes("fsGet failed: 403")) notFound();
    throw e;
  }
  if (!blog || blog.siteId !== siteId) notFound();

  const toc = extractToc(blog.content);
  const html = mdToHtml(blog.content);
  const bestPrice = blog.relatedAsin
    ? await fetchBestPrice(blog.relatedAsin)
    : null;

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.chairscope.com"
  ).replace(/\/$/, "");
  const canonical = `${siteUrl}/blog/${blog.slug}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/* breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
        <span className="mx-2">/</span>
        <Link href="/blog" className="underline">
          ブログ
        </Link>
      </nav>

      <header className="mt-3">
        <h1 className="text-2xl font-bold">{blog.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span>公開: {fmt(blog.publishedAt ?? blog.updatedAt)}</span>
          {blog.updatedAt &&
          blog.publishedAt &&
          blog.updatedAt > blog.publishedAt ? (
            <span>（更新: {fmt(blog.updatedAt)}）</span>
          ) : null}
          <span className="rounded bg-gray-100 px-2 py-0.5">
            本ページは広告を含みます
          </span>
        </div>
        {blog.summary && (
          <p className="mt-3 text-sm text-gray-700">{blog.summary}</p>
        )}
      </header>

      {/* 関連商品CTA（あれば） */}
      {bestPrice && (
        <div className="mt-4 rounded-xl border bg-white p-4 text-sm">
          <div className="mb-1">
            関連商品の最安値:{" "}
            <strong>
              {new Intl.NumberFormat("ja-JP", {
                style: "currency",
                currency: "JPY",
              }).format(bestPrice.price)}
            </strong>
            （{bestPrice.source === "amazon" ? "Amazon" : "楽天"} /{" "}
            {fmt(bestPrice.updatedAt)}）
          </div>
          <a
            href={bestPrice.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="inline-block rounded-lg border px-4 py-2 font-medium hover:shadow-sm"
          >
            {bestPrice.source === "amazon" ? "Amazonで見る" : "楽天で見る"}
          </a>
        </div>
      )}

      {/* 目次 */}
      {toc.length > 0 && (
        <aside className="mt-6 rounded-xl border bg-white p-4 text-sm">
          <div className="mb-2 font-medium">目次</div>
          <ul className="space-y-1">
            {toc.map((t, i) => (
              <li key={i} className={t.level === 3 ? "ml-4" : ""}>
                <a href={`#${t.id}`} className="underline">
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {/* 本文 */}
      <article className="prose prose-neutral mt-6 max-w-none">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      {/* JSON-LD */}
      <link rel="canonical" href={canonical} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: blog.title,
            description: blog.summary ?? makeSummaryFromContent(blog.content),
            image: blog.imageUrl,
            url: canonical,
            datePublished: blog.publishedAt
              ? new Date(blog.publishedAt).toISOString()
              : undefined,
            dateModified: blog.updatedAt
              ? new Date(blog.updatedAt).toISOString()
              : undefined,
            mainEntityOfPage: canonical,
          }),
        }}
      />
    </main>
  );
}
