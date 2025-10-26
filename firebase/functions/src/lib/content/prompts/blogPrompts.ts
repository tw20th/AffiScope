// firebase/functions/src/lib/prompts/blogPrompts.ts
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

/* =========================================================
   共通: 悩みボタン（painRules）→ ショートコード化
   ========================================================= */
type SiteDoc = {
  painRules?: Array<{ id: string; label?: string }>;
  defaultPersona?: string;
};

async function loadPainShortcodes(siteId: string): Promise<string[]> {
  try {
    const snap = await db.collection("sites").doc(siteId).get();
    const f = (snap.data() ?? {}) as SiteDoc;

    const rules = Array.isArray(f.painRules) ? f.painRules : [];
    const shorts = rules.slice(0, 5).map((r) => {
      const label = (r.label ?? r.id ?? "").toString();
      const text = label.replace(/\s+/g, " ").slice(0, 28);
      return `[[pain tag="${label}" text="${text} を見る"]]`;
    });
    if (shorts.length > 0) return shorts;
  } catch {
    // no-op → fallback
  }

  // フォールバック（一般向け）
  return [
    '[[pain tag="腰痛" text="腰の負担を減らす椅子を探す"]]',
    '[[pain tag="蒸れ" text="通気性の高いチェアを見る"]]',
    '[[pain tag="コスパ" text="コスパ重視の椅子を見る"]]',
  ];
}

/** 記事末尾に“関連ガイド”のCTA群を付与 */
export async function appendPainCTASection(
  siteId: string,
  content: string
): Promise<string> {
  const shorts = await loadPainShortcodes(siteId);
  const section = [
    "",
    "## 関連ガイド",
    "悩みから選べます。気になる項目をタップしてください。",
    "",
    ...shorts.map((s) => `- ${s}`),
    "",
    "> ※本ページは広告を含みます",
    "",
  ].join("\n");

  return `${(content || "").trim()}\n\n${section}`;
}

/* =========================================================
   GSC “狙いクエリ” 取得（sites/{siteId}/seo/latest.rows[] 想定）
   ========================================================= */
type SeoRow = {
  query: string;
  clicks?: number;
  impressions?: number;
  ctr?: number; // 0.0123
  position?: number; // 平均掲載順位
};

function deriveSeeds(name: string): string[] {
  return Array.from(
    new Set(
      String(name || "")
        .split(/[\s\-＿—‐／・\|,，、\[\]\(\)]+/g)
        .filter((s) => s.length >= 2)
        .slice(0, 6)
    )
  );
}

function fallbackQuery(productName: string, suffix: string) {
  const seeds = deriveSeeds(productName);
  const head = seeds[0] || "モバイルバッテリー";
  return `${head} ${suffix}`;
}

async function pickTargetQuery(
  siteId: string,
  seeds: string[]
): Promise<string | null> {
  try {
    const snap = await db
      .collection("sites")
      .doc(siteId)
      .collection("seo")
      .doc("latest")
      .get();

    const rows = (snap.data()?.rows as SeoRow[]) || [];
    if (!rows.length) return null;

    // “高表示 × 低CTR × 8〜15位”を優先。製品名シード語が含まれたら微加点。
    const scored = rows
      .map((r) => {
        const hit = seeds.some((w) => r.query.includes(w));
        const impressions = Number(r.impressions || 0);
        const ctr = Number(r.ctr || 0);
        const pos = Number(r.position || 0);
        const posBoost = pos > 7 && pos < 16 ? 1.2 : 1.0;
        const hitBoost = hit ? 1.1 : 1.0;
        const score = impressions * (1 - ctr) * posBoost * hitBoost;
        return { ...r, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.query ?? rows[0]?.query ?? null;
  } catch {
    return null;
  }
}

/* =========================================================
   朝（price-drop）: GSC連携版（async）
   ========================================================= */
export async function buildMorningMessages(input: {
  siteId: string;
  asin: string;
  productName: string;
}) {
  const seeds = deriveSeeds(input.productName);
  const target =
    (await pickTargetQuery(input.siteId, seeds)) ||
    fallbackQuery(input.productName, "値下げ");

  const sys =
    "あなたは日本語のSEOライターです。指定の“狙いクエリ”の検索意図（値下げ/購入検討）に沿ってMarkdownで作成。冒頭で『誰向け→結論（価格差%/円）』を明示。表(5行)とFAQ(3)を含め、過剰表現は禁止。最後に広告表記。外部リンクはAmazonのみ。";
  const user =
    `商品名: ${input.productName}\n` +
    `ASIN: ${input.asin}\n` +
    `サイト: ${input.siteId}\n` +
    `狙いクエリ: ${target}\n` +
    `出力構成:\n` +
    `# タイトル（自然にクエリ含有）\n` +
    `導入: この人向け→結論（直近の価格差%/円）\n` +
    `## ここが買い（3点）\n` +
    `## 比較表（同カテゴリ5製品｜価格/容量/出力/重量/サイズ）\n` +
    `## どこで買う？（Amazonリンク）\n` +
    `## FAQ（3問）\n` +
    `> ※本ページは広告を含みます`;

  return { sys, user };
}

/* =========================================================
   昼（who-fit / レビュー）: GSC連携版（async）
   ========================================================= */
export async function buildNoonMessages(input: {
  siteId: string;
  asin: string;
  productName: string;
}) {
  const seeds = deriveSeeds(input.productName);
  const target =
    (await pickTargetQuery(input.siteId, seeds)) ||
    fallbackQuery(input.productName, "口コミ 評判");

  const sys =
    "あなたは日本語のSEOライターです。用途別に『誰に向くか』を明確にし、Pros/ConsとFAQを含めてMarkdownで作成します。誇張禁止。外部リンクはAmazonのみ。最後に広告表記を入れてください。";
  const user =
    `商品名: ${input.productName}\n` +
    `ASIN: ${input.asin}\n` +
    `サイト: ${input.siteId}\n` +
    `狙いクエリ: ${target}\n` +
    `出力構成:\n` +
    `# タイトル（自然にクエリを含める）\n` +
    `## こんな人に刺さる\n- 箇条書き3つ\n` +
    `## 強み(Pros)\n- 3点\n` +
    `## 気になる点(Cons)\n- 3点（過度に煽らない）\n` +
    `## どこで買う？（Amazonリンク1つ）\n` +
    `## FAQ（3問）\n` +
    `> ※本ページは広告を含みます`;

  return { sys, user };
}
