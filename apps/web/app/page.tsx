// apps/web/app/page.tsx
import Link from "next/link";
import type { Product } from "@affiscope/shared-types";
import { fsRunQuery, vNum, vStr, docIdFromName } from "@/lib/firestore-rest";
import { getServerSiteId } from "@/lib/site-server";
import ProductCard from "@/components/products/ProductCard";
import TrustBar from "@/components/common/TrustBar";
import SiteFooter from "@/components/common/SiteFooter";

export const revalidate = 60;
export const dynamic = "force-dynamic";

/** ===== サイト設定（Firestore REST直読・ENV未設定でも安全にフォールバック） ===== */
type SiteConfig = {
  siteId: string;
  displayName?: string;
  brand?: { primary?: string; accent?: string; logoUrl?: string };
  categoryPreset?: string[];
  [k: string]: unknown;
};

async function loadSiteConfigLocal(siteId: string): Promise<SiteConfig | null> {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY;
  if (!projectId || !apiKey) return null; // ENV未設定時はnullで返す

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sites/${encodeURIComponent(
      siteId
    )}`
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const json: any = await res.json();
  const fields = json.fields ?? {};
  const get = (k: string) => fields[k];
  const str = (k: string) => get(k)?.stringValue as string | undefined;
  const arr = (k: string) =>
    (get(k)?.arrayValue?.values ?? []).map((v: any) => v?.stringValue ?? "");

  const brand = get("brand")?.mapValue?.fields ?? {};
  const brandStr = (k: string) => brand[k]?.stringValue as string | undefined;

  return {
    siteId,
    displayName: str("displayName") ?? "AffiScope",
    brand: {
      primary: brandStr("primary"),
      accent: brandStr("accent"),
      logoUrl: brandStr("logoUrl"),
    },
    categoryPreset: arr("categoryPreset") ?? [],
  };
}

/** ===== 最新ブログ N件（公開のみ） ===== */
async function fetchLatestBlogs(siteId: string, limit = 3) {
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
    return docs.map((d) => ({
      slug: docIdFromName(d.name),
      title: vStr(d.fields, "title") ?? "(no title)",
      summary: vStr(d.fields, "summary") ?? "",
      imageUrl: vStr(d.fields, "imageUrl"),
      updatedAt: vNum(d.fields, "updatedAt") ?? 0,
    }));
  } catch {
    // orderBy未対応環境などでも最低限動くフォールバック
    const docs = await fsRunQuery({
      collection: "blogs",
      where: [
        { field: "status", value: "published" },
        { field: "siteId", value: siteId },
      ],
      limit,
    }).catch(() => []);
    return docs.map((d) => ({
      slug: docIdFromName(d.name),
      title: vStr(d.fields, "title") ?? "(no title)",
      summary: vStr(d.fields, "summary") ?? "",
      imageUrl: vStr(d.fields, "imageUrl"),
      updatedAt: vNum(d.fields, "updatedAt") ?? 0,
    }));
  }
}

/** ===== ピックアップ商品 N件（createdAt desc） ===== */
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
    }).catch(() => [] as any[]);

    return docs.map((d) => {
      const f = d.fields;
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
      } satisfies Product;
    });
  };

  const first = await run(true);
  if (first.length > 0 || !categoryId) return first;
  return run(false);
}

/** ===== ページ本体 ===== */
export default async function Page() {
  // ENV を最優先（cookieが古くても上書き）
  const siteId = process.env.NEXT_PUBLIC_SITE_ID ?? getServerSiteId();

  const site =
    (await loadSiteConfigLocal(siteId)) ??
    ({
      siteId,
      displayName: "AffiScope",
      brand: { primary: "#16a34a", accent: "#0ea5e9", logoUrl: "" },
      categoryPreset: ["gaming-chair"],
    } as const);

  const firstCategory = site.categoryPreset?.[0];

  const [featured, latestBlogs] = await Promise.all([
    firstCategory
      ? fetchFeaturedProducts(siteId, firstCategory, 8)
      : Promise.resolve<Product[]>([]),
    fetchLatestBlogs(siteId, 3),
  ]);

  return (
    <>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-4">
          <h1 className="text-2xl md:text-3xl font-bold">
            ゲーミングチェアの比較・最安情報
          </h1>
          <p className="text-sm opacity-70">
            Amazonの価格と新着ブログを毎日自動更新
          </p>
        </header>

        <TrustBar
          dataSource="Amazon"
          updatedText="毎日自動更新"
          note="本ページは広告を含みます"
        />

        {/* Featured Products */}
        <section className="mb-12">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">注目の商品</h2>
            <Link href="/products" className="text-sm underline">
              すべて見る
            </Link>
          </div>

          {featured.length === 0 ? (
            <div className="rounded-lg border p-6 text-sm opacity-70">
              まだ商品がありません。クローラや同期をお待ちください。
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {featured.map((p) => (
                <ProductCard key={p.asin} p={p} />
              ))}
            </ul>
          )}
        </section>

        {/* Latest Blogs */}
        <section className="mb-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">新着ブログ</h2>
            <Link href="/blog" className="text-sm underline">
              一覧へ
            </Link>
          </div>

          {latestBlogs.length === 0 ? (
            <div className="rounded-lg border p-6 text-sm opacity-70">
              公開済みのブログがありません。
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {latestBlogs.map((b) => (
                <li
                  key={b.slug}
                  className="rounded-xl border p-4 transition hover:shadow-sm"
                >
                  <Link href={`/blog/${b.slug}`}>
                    <div className="mb-1 line-clamp-2 text-base font-medium">
                      {b.title}
                    </div>
                    {b.summary && (
                      <p className="line-clamp-3 text-sm opacity-70">
                        {b.summary}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>{" "}
    </>
  );
}
