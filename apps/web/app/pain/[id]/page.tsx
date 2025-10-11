import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSiteId } from "@/lib/site-server";
import {
  fsRunQuery,
  vNum,
  vStr,
  fsGetStringArray as vStrArr,
  docIdFromName,
} from "@/lib/firestore-rest";
import type { Product } from "@affiscope/shared-types";
import ProductCard from "@/components/products/ProductCard";
import { decodePainRules } from "@/lib/pain-rules";

export const revalidate = 60;
export const dynamic = "force-dynamic";

async function loadPainRule(siteId: string, id: string) {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY;
  if (!projectId || !apiKey) return null;

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sites/${encodeURIComponent(
      siteId
    )}`
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const json = (await res.json()) as
    | { fields?: Record<string, unknown> }
    | undefined;
  const rules = decodePainRules(json?.fields);
  return rules.find((r) => r.id === id) ?? null;
}

// タグ OR で商品取得（array-contains なし版）
async function fetchProductsByTags(
  siteId: string,
  tags: string[],
  limit = 24
): Promise<Product[]> {
  if (tags.length === 0) return [];

  // サーバ取得は siteId のみ。多めに取り、クライアントで tags をフィルタ
  const docs = await fsRunQuery({
    collection: "products",
    where: [{ field: "siteId", value: siteId }],
    orderBy: [{ field: "updatedAt", direction: "DESCENDING" as const }],
    limit: Math.max(limit * 3, 60), // 少し多めに
  }).catch(() => []);

  const want = new Set(tags);
  const seen = new Set<string>();
  const rows: Product[] = [];

  for (const d of docs) {
    const id = docIdFromName(d.name);
    if (seen.has(id)) continue;
    const f = d.fields as Record<string, any>;
    const tagArr = vStrArr(f, "tags") ?? [];

    // 交差があるか
    if (!tagArr.some((t) => want.has(t))) continue;

    seen.add(id);

    const price = vNum(f, "bestPrice.price");
    const url = vStr(f, "bestPrice.url");
    const source = vStr(f, "bestPrice.source") as
      | "amazon"
      | "rakuten"
      | undefined;
    const updatedAt = vNum(f, "bestPrice.updatedAt");

    rows.push({
      asin: id,
      title: vStr(f, "title") ?? "",
      brand: vStr(f, "brand") ?? undefined,
      imageUrl: vStr(f, "imageUrl") ?? undefined,
      categoryId: vStr(f, "categoryId") ?? "",
      siteId,
      tags: tagArr,
      specs: undefined,
      offers: [],
      bestPrice:
        typeof price === "number" &&
        url &&
        source &&
        typeof updatedAt === "number"
          ? { price, url, source, updatedAt }
          : undefined,
      priceHistory: [],
      aiSummary: vStr(f, "aiSummary") ?? undefined,
      views: vNum(f, "views") ?? 0,
      createdAt: vNum(f, "createdAt") ?? 0,
      updatedAt: vNum(f, "updatedAt") ?? 0,
    });

    if (rows.length >= limit) break;
  }

  return rows;
}

export default async function PainPage({ params }: { params: { id: string } }) {
  const siteId = getServerSiteId();
  const rule = await loadPainRule(siteId, params.id);
  if (!rule) return notFound();

  const products = await fetchProductsByTags(siteId, rule.tags, 24);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="text-sm text-gray-500">
        <Link href="/" className="underline">
          ホーム
        </Link>
        <span className="mx-1">/</span>
        <span>悩み: {rule.label}</span>
      </nav>

      <h1 className="mt-3 text-2xl font-bold">{rule.label}</h1>

      {/* 共感 → 解決（簡易コピー。必要に応じて自動生成に置換可） */}
      <section className="mt-4 rounded-xl border p-4">
        <h2 className="mb-2 font-semibold">こんな時はありませんか？</h2>
        <p className="text-sm opacity-80">
          毎日の作業や趣味の時間で感じる不快感・不安は、小さな工夫と正しいプロダクト選びで大きく改善できます。
          下では、{rule.tags.map((t) => `#${t}`).join(" / ")}{" "}
          に当てはまるおすすめを厳選しました。
        </p>
      </section>

      {/* 商品一覧（悩みに合う） */}
      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">おすすめ</h2>
          <div className="flex gap-2 text-xs opacity-70">
            {rule.tags.map((t) => (
              <Link
                key={t}
                href={`/products?tag=${encodeURIComponent(t)}`}
                className="rounded-full border px-2 py-0.5 hover:bg-gray-50"
              >
                #{t}
              </Link>
            ))}
          </div>
        </div>

        {products.length === 0 ? (
          <div className="rounded-lg border p-6 text-sm opacity-70">
            該当商品がまだありません。
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.asin} p={p} />
            ))}
          </ul>
        )}
      </section>

      {/* CTA */}
      <section className="mt-10 rounded-xl border p-4 text-sm">
        <p className="mb-2 font-medium">購入前チェック</p>
        <ul className="list-inside list-disc opacity-80">
          <li>用途に合うタグ（{rule.tags.join(" / ")}）が付いているか</li>
          <li>価格と在庫、直近の更新日時を確認</li>
          <li>気になる商品はブックマークして比較</li>
        </ul>
      </section>
    </main>
  );
}
