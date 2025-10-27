// apps/web/app/page.tsx
import Link from "next/link";
import type { Product } from "@affiscope/shared-types";
import type { FsValue } from "@/lib/firestore-rest";

import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";
import { getServerSiteId } from "@/lib/site-server";

// import PainNav, { PainItem } from "@/components/common/PainNav"; // ← 不要になったら削除OK
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

type FsValueCompat = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: Record<string, any> };
  arrayValue?: { values?: FsValueCompat[] };
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
      featured: "悩み別おすすめ",
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
      const f = d.fields as Record<string, FsValue>;
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
          fields: Record<string, unknown>;
        }>
    );
    return docs.map((d) => {
      const f = d.fields as Record<string, FsValue>;
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
          fields: Record<string, unknown>;
        }>
    );
    return docs.map((d) => {
      const f = d.fields as Record<string, FsValue>;
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

/* ===== ユーティリティ（悩みカード） ===== */
type CardTheme = {
  cardBg: string;
  ctaBg: string;
  accentText: string;
  emoji: string;
};

function themeFor(id: string): CardTheme {
  if (id.includes("back"))
    return {
      cardBg: "bg-gray-50",
      ctaBg: "bg-emerald-600 hover:bg-emerald-700",
      accentText: "text-emerald-700",
      emoji: "😣",
    };
  if (id.includes("sweat"))
    return {
      cardBg: "bg-sky-50",
      ctaBg: "bg-sky-600 hover:bg-sky-700",
      accentText: "text-sky-700",
      emoji: "🌬️",
    };
  if (id.includes("best_value"))
    return {
      cardBg: "bg-amber-50",
      ctaBg: "bg-amber-600 hover:bg-amber-700",
      accentText: "text-amber-700",
      emoji: "💰",
    };
  return {
    cardBg: "bg-indigo-50",
    ctaBg: "bg-indigo-600 hover:bg-indigo-700",
    accentText: "text-indigo-700",
    emoji: "✨",
  };
}

function PainButtonsGridFromRules({ rules }: { rules: PainRuleLite[] }) {
  if (!rules || rules.length === 0) return null;
  return (
    <section aria-labelledby="pain-buttons-heading" className="mx-auto w-full">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="pain-buttons-heading" className="text-lg md:text-xl font-bold">
          悩みから選ぶ
        </h2>
        <p className="text-xs text-gray-500">状況に合う商品へ最短導線</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {rules.map((r) => {
          const t = themeFor(r.id);
          return (
            <Link
              key={r.id}
              href={`/pain/${encodeURIComponent(r.id)}`}
              className={[
                "group block rounded-2xl border border-gray-100 p-5",
                "shadow-sm hover:shadow-md transition-all",
                t.cardBg,
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <div className="text-3xl leading-none">{t.emoji}</div>
                <div className="flex-1">
                  <h3 className="text-base md:text-lg font-semibold tracking-tight">
                    {r.label}
                  </h3>
                  {r.tags && r.tags.length > 0 && (
                    <p className="mt-1 text-sm text-gray-600">
                      #{r.tags.join(" #")}
                    </p>
                  )}
                </div>
              </div>

              <hr className="my-4 border-gray-200" />
              <div
                className={[
                  "inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold text-white",
                  "transition-colors group-hover:translate-x-0.5",
                  t.ctaBg,
                ].join(" ")}
              >
                今すぐチェック <span className="ml-1">→</span>
              </div>
              <p
                className={[
                  "mt-3 text-xs font-medium opacity-80",
                  t.accentText,
                ].join(" ")}
              >
                押すと「{r.label}」の解決ページへ
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
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

      {/* ヒーロー */}
      <header className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
        <p className="text-sm opacity-70">{subtitle}</p>
      </header>
      {/* A8 Offers CTA（追加） */}
      <div className="mb-6">
        <Link
          href="/offers?v=hero"
          className="inline-flex items-center rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm hover:bg-emerald-700 transition"
        >
          家電レンタルおすすめを見る <span className="ml-1">→</span>
        </Link>
        <p className="mt-1 text-xs text-gray-500">※ 本ページは広告を含みます</p>
      </div>

      <HeroBadges dataSourceLabel={dataSourceLabel} note={note} />

      {/* 悩みナビ（カード版） */}
      <div className="my-10">
        <PainButtonsGridFromRules rules={site.painRules ?? []} />
      </div>

      {/* 商品・ブログ */}
      <FeaturedSection title={featuredTitle} items={featured} />
      <BlogsSection title={blogsTitle} items={latestBlogs} />
    </main>
  );
}
