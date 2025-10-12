// apps/web/app/blog/[slug]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSiteId } from "@/lib/site-server";
import { fetchBlogBySlug, fetchBestPrice } from "@/lib/queries";

import PainRail from "@/components/pain/PainRail";
import { loadPainRules } from "@/lib/pain-helpers";

export const revalidate = 3600;
export const dynamic = "force-dynamic";

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
    if (m)
      items.push({
        level: m[1].length === 2 ? 2 : 3,
        text: m[2].trim(),
        id: slugify(m[2].trim()),
      });
  }
  return items;
}

const outUrl = (asin: string, url?: string, src = "blog") =>
  url
    ? `/out/${encodeURIComponent(asin)}?to=${encodeURIComponent(
        url
      )}&src=${src}`
    : undefined;

// ---- SEO ----
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}) {
  const blog = await fetchBlogBySlug(params.slug).catch(() => null);
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
  const painRules = await loadPainRules(siteId);

  const blog = await fetchBlogBySlug(params.slug);
  if (!blog || blog.siteId !== siteId) notFound();

  const toc = extractToc(blog.content);
  const html = mdToHtml(blog.content);
  const bestPrice: BestPrice | null = blog.relatedAsin
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
        <span className="mx-2">/</span>
        <span className="opacity-70">{blog.title}</span>
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
              {
                "@type": "ListItem",
                position: 3,
                name: blog.title,
                item: canonical,
              },
            ],
          }),
        }}
      />

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
      {bestPrice && blog.relatedAsin && (
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
            href={outUrl(blog.relatedAsin, bestPrice.url, "blog")}
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

      {/* 関連ガイド（悩みから選ぶ） */}
      <div className="mt-8 rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm text-gray-600">関連ガイド</div>
        <PainRail className="my-10" />
      </div>

      {/* 次の一歩 */}
      <div className="mt-8 rounded-2xl border bg-white p-5">
        <div className="font-semibold">次の一歩</div>
        <ul className="mt-2 list-disc pl-6 text-sm">
          <li>
            <Link href="/products" className="underline">
              条件で商品をしぼる
            </Link>
          </li>
          {bestPrice && blog.relatedAsin && (
            <li>
              <a
                href={outUrl(blog.relatedAsin, bestPrice.url, "blog_bottom")}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="underline"
              >
                公式の価格ページを開く（
                {bestPrice.source === "amazon" ? "Amazon" : "楽天"}）
              </a>
            </li>
          )}
          <li>
            <Link href="/blog" className="underline">
              他の値下げ・比較記事を見る
            </Link>
          </li>
        </ul>
      </div>

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
