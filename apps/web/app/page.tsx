import Link from "next/link";
import type { Product } from "@affiscope/shared-types";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";
import { getServerSiteId } from "@/lib/site-server";

import PainNav, { PainItem } from "@/components/common/PainNav";
import { decodePainRules, type PainRuleLite } from "@/lib/pain-rules";
import HeroBadges from "@/components/home/HeroBadges";
import FeaturedSection from "@/components/home/FeaturedSection";
import BlogsSection, { type BlogSummary } from "@/components/home/BlogsSection";

export const revalidate = 60;
export const dynamic = "force-dynamic";

/* ===== サイト設定 ===== */
type BrandLite = { primary?: string; accent?: string; logoUrl?: string };
type SiteConfigDoc = {
  siteId: string;
  displayName?: string;
  brand?: BrandLite;
  categoryPreset?: string[];
  homeCopy?: {
    title?: string;
    subtitle?: string;
    dataSourceLabel?: string;
    note?: string;
    featuredTitle?: string;
    blogsTitle?: string;
  };
  painRules?: PainRuleLite[];
  [k: string]: unknown;
};

async function loadSiteConfig(siteId: string): Promise<SiteConfigDoc> {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY;
  if (!projectId || !apiKey) return fallbackConfig(siteId);

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sites/${encodeURIComponent(
      siteId
    )}`
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return fallbackConfig(siteId);

  const json = (await res.json()) as
    | { fields?: Record<string, unknown> }
    | undefined;
  const f = json?.fields ?? {};

  const get = (k: string) =>
    f[k] as
      | {
          stringValue?: string;
          arrayValue?: { values?: Array<{ stringValue?: string }> };
          mapValue?: { fields?: Record<string, { stringValue?: string }> };
        }
      | undefined;

  const str = (k: string) => get(k)?.stringValue ?? undefined;
  const arr = (k: string) =>
    (get(k)?.arrayValue?.values ?? []).map((v) => v?.stringValue ?? "");

  const brandFields = get("brand")?.mapValue?.fields ?? {};
  const bstr = (k: string) => brandFields[k]?.stringValue ?? undefined;

  const hcFields = (get("homeCopy")?.mapValue?.fields ?? {}) as Record<
    string,
    { stringValue?: string }
  >;

  const cfg: SiteConfigDoc = {
    siteId,
    displayName: str("displayName") ?? "AffiScope",
    brand: {
      primary: bstr("primary"),
      accent: bstr("accent"),
      logoUrl: bstr("logoUrl"),
    },
    categoryPreset: arr("categoryPreset"),
    homeCopy:
      Object.keys(hcFields).length > 0
        ? {
            title: hcFields.title?.stringValue,
            subtitle: hcFields.subtitle?.stringValue,
            dataSourceLabel: hcFields.dataSourceLabel?.stringValue,
            note: hcFields.note?.stringValue,
            featuredTitle: hcFields.featuredTitle?.stringValue,
            blogsTitle: hcFields.blogsTitle?.stringValue,
          }
        : undefined,
    painRules: decodePainRules(f),
  };
  return withDerivedCopy(cfg);
}

function fallbackConfig(siteId: string): SiteConfigDoc {
  const cfg: SiteConfigDoc = {
    siteId,
    displayName: "AffiScope",
    brand: { primary: "#16a34a", accent: "#0ea5e9", logoUrl: "" },
    categoryPreset: ["gaming-chair"],
    painRules: [
      {
        id: "back_pain_long_sitting",
        label: "腰痛で長時間座れない",
        tags: ["腰痛対策", "姿勢改善"],
      },
      {
        id: "sweaty",
        label: "蒸れて不快（夏でも快適に座りたい）",
        tags: ["蒸れ対策", "メッシュ"],
      },
      {
        id: "best_value",
        label: "コスパよく失敗したくない",
        tags: ["コスパ重視"],
      },
    ],
  };
  return withDerivedCopy(cfg);
}

function withDerivedCopy(cfg: SiteConfigDoc): SiteConfigDoc {
  const cat = cfg.categoryPreset?.[0];
  const defaultsByCat: Record<
    string,
    {
      title: string;
      subtitle: string;
      featured: string;
      blogs: string;
      dataSource: string;
      note: string;
    }
  > = {
    "gaming-chair": {
      title: "ゲーミングチェアの比較・最安情報",
      subtitle: "Amazonの価格と新着ブログを毎日自動更新",
      featured: "注目の商品",
      blogs: "新着ブログ",
      dataSource: "Amazon",
      note: "本ページは広告を含みます",
    },
    "power-bank": {
      title: "モバイルバッテリーの比較・最安情報",
      subtitle: "Amazonの価格と新着ブログを毎日自動更新",
      featured: "注目のモバイルバッテリー",
      blogs: "新着ブログ",
      dataSource: "Amazon",
      note: "本ページは広告を含みます",
    },
  };

  const d = (cat && defaultsByCat[cat]) || defaultsByCat["gaming-chair"];
  const hc = cfg.homeCopy ?? {};
  cfg.homeCopy = {
    title: hc.title ?? d.title,
    subtitle: hc.subtitle ?? d.subtitle,
    dataSourceLabel: hc.dataSourceLabel ?? d.dataSource,
    note: hc.note ?? d.note,
    featuredTitle: hc.featuredTitle ?? d.featured,
    blogsTitle: hc.blogsTitle ?? d.blogs,
  };
  return cfg;
}

/* ===== データ取得 ===== */
async function fetchLatestBlogs(
  siteId: string,
  limit = 3
): Promise<BlogSummary[]> {
  try {
    const docs = await fsRunQuery({
      collection: "blogs",
      where: [
        { field: "status", value: "published" },
        { field: "siteId", value: siteId },
      ],
      orderBy: [{ field: "updatedAt", direction: "DESCENDING" }],
      limit,
    });
    return docs.map((d) => {
      const f = d.fields as Record<string, any>;
      return {
        slug: docIdFromName(d.name),
        title: vStr(f, "title") ?? "(no title)",
        summary: vStr(f, "summary") ?? "",
        imageUrl: vStr(f, "imageUrl"),
        updatedAt: vNum(f, "updatedAt") ?? 0,
      };
    });
  } catch {
    const docs = await fsRunQuery({
      collection: "blogs",
      where: [
        { field: "status", value: "published" },
        { field: "siteId", value: siteId },
      ],
      limit,
    }).catch(
      () =>
        [] as unknown as Array<{
          name: string;
          fields: Record<string, any>;
        }>
    );
    return docs.map((d) => {
      const f = d.fields as Record<string, any>;
      return {
        slug: docIdFromName(d.name),
        title: vStr(f, "title") ?? "(no title)",
        summary: vStr(f, "summary") ?? "",
        imageUrl: vStr(f, "imageUrl"),
        updatedAt: vNum(f, "updatedAt") ?? 0,
      };
    });
  }
}

async function fetchFeaturedProducts(
  siteId: string,
  categoryId?: string,
  limit = 8
): Promise<Product[]> {
  const run = async (withCategory: boolean) => {
    const where =
      withCategory && categoryId
        ? [
            { field: "siteId", value: siteId },
            { field: "categoryId", value: categoryId },
          ]
        : [{ field: "siteId", value: siteId }];

    const docs = await fsRunQuery({
      collection: "products",
      where,
      orderBy: [{ field: "createdAt", direction: "DESCENDING" as const }],
      limit,
    }).catch(
      () =>
        [] as unknown as Array<{
          name: string;
          fields: Record<string, any>;
        }>
    );

    return docs.map((d) => {
      const f = d.fields as Record<string, any>;
      const price = vNum(f, "bestPrice.price");
      const url = vStr(f, "bestPrice.url");
      const source = vStr(f, "bestPrice.source") as
        | "amazon"
        | "rakuten"
        | undefined;
      const updatedAt = vNum(f, "bestPrice.updatedAt");
      const bestPrice =
        typeof price === "number" &&
        url &&
        source &&
        typeof updatedAt === "number"
          ? { price, url, source, updatedAt }
          : undefined;

      return {
        asin: docIdFromName(d.name),
        title: vStr(f, "title") ?? "",
        brand: vStr(f, "brand") ?? undefined,
        imageUrl: vStr(f, "imageUrl") ?? undefined,
        categoryId: vStr(f, "categoryId") ?? categoryId ?? "",
        siteId,
        tags: [],
        specs: undefined,
        offers: [],
        bestPrice,
        priceHistory: [],
        aiSummary: undefined,
        views: vNum(f, "views") ?? 0,
        createdAt: vNum(f, "createdAt") ?? 0,
        updatedAt: vNum(f, "updatedAt") ?? 0,
      } satisfies Product;
    });
  };

  const first = await run(true);
  if (first.length > 0 || !categoryId) return first;
  return run(false);
}

/* ===== ページ本体 ===== */
export default async function Page() {
  const siteId = getServerSiteId();
  const site = await loadSiteConfig(siteId);
  const firstCategory = site.categoryPreset?.[0];

  const [featured, latestBlogs] = await Promise.all([
    firstCategory
      ? fetchFeaturedProducts(siteId, firstCategory, 8)
      : Promise.resolve<Product[]>([]),
    fetchLatestBlogs(siteId, 3),
  ]);

  const title = site.homeCopy?.title ?? "比較・最安情報";
  const subtitle = site.homeCopy?.subtitle ?? "";
  const dataSourceLabel = site.homeCopy?.dataSourceLabel ?? "Amazon";
  const note = site.homeCopy?.note ?? "本ページは広告を含みます";
  const featuredTitle = site.homeCopy?.featuredTitle ?? "注目の商品";
  const blogsTitle = site.homeCopy?.blogsTitle ?? "新着ブログ";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* breadcrumb */}
      <nav className="mb-2 text-sm text-gray-500">
        {/* トップは “ホーム” 単独表示 */}
        <span className="opacity-70">ホーム</span>
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
                item:
                  (
                    process.env.NEXT_PUBLIC_SITE_URL ??
                    "https://www.chairscope.com"
                  ).replace(/\/$/, "") + "/",
              },
            ],
          }),
        }}
      />
      {/* ▲▲▲ ここまで貼り付け ▲▲▲ */}
      <header className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
        <p className="text-sm opacity-70">{subtitle}</p>
      </header>

      <HeroBadges dataSourceLabel={dataSourceLabel} note={note} />

      {/* 悩みナビ */}
      <PainNav
        items={(site.painRules ?? []).map<PainItem>((r) => ({
          id: r.id,
          label: r.label,
          tags: r.tags,
          icon: r.id.includes("back")
            ? "💺"
            : r.id.includes("sweat")
            ? "🌬️"
            : r.id.includes("blackout")
            ? "🔌"
            : r.id.includes("camp")
            ? "🏕️"
            : r.id.includes("workation")
            ? "💻"
            : r.id.includes("safety")
            ? "🧯"
            : r.id.includes("best_value")
            ? "💰"
            : "✨",
        }))}
        className="mb-10"
      />

      <FeaturedSection title={featuredTitle} items={featured} />
      <BlogsSection title={blogsTitle} items={latestBlogs} />
    </main>
  );
}
