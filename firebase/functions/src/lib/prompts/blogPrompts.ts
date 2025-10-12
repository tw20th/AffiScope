// firebase/functions/src/lib/prompts/blogPrompts.ts
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

/** サイト設定から painRules を取得してショートコードに変換 */
async function loadPainShortcodes(siteId: string): Promise<string[]> {
  try {
    const snap = await db.collection("sites").doc(siteId).get();
    const f = (snap.data() ?? {}) as {
      painRules?: Array<{ id: string; label?: string }>;
    };

    const rules = Array.isArray(f.painRules) ? f.painRules : [];
    const shorts = rules
      .slice(0, 5)
      .map(
        (r) =>
          `[[pain tag="${r.label ?? r.id}" text="${(r.label ?? r.id)
            .replace(/\s+/g, " ")
            .slice(0, 28)} を見る"]]`
      );

    if (shorts.length > 0) return shorts;
  } catch {
    // no-op (fallback 下へ)
  }

  // フォールバック（一般的な3種）
  return [
    '[[pain tag="腰痛" text="腰の負担を減らす椅子を探す"]]',
    '[[pain tag="蒸れ" text="通気性の高いチェアを見る"]]',
    '[[pain tag="コスパ" text="コスパ重視の椅子を見る"]]',
  ];
}

/** 記事末尾に“関連ガイド”としてCTAショートコード群を付与 */
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
  return `${content.trim()}\n\n${section}`;
}

/* =========================
   OpenAI プロンプト（共通化）
   ========================= */

export function buildMorningMessages(input: {
  siteId: string;
  asin: string;
  productName: string;
}) {
  const sys =
    "あなたは日本語のSEOライターです。商品名と価格情報をもとに、検索意図（値下げ情報/購入検討）に合致した短いブログ記事をMarkdownで書いてください。広告表記、見出し、箇条書き、最後にCTA(公式リンク)を含めること。";
  const user =
    `商品名: ${input.productName}\n` +
    `ASIN: ${input.asin}\n` +
    `サイト: ${input.siteId}\n` +
    `トーン: 誠実・要点を簡潔に\n` +
    `出力: # 見出し / ポイント3つ / どこで買う？(Amazonリンクだけ) / まとめ`;
  return {
    sys,
    user,
  };
}

export function buildNoonMessages(input: {
  siteId: string;
  asin: string;
  productName: string;
}) {
  const sys =
    "あなたは日本語のSEOライターです。朝記事とは重複しない観点で、用途別（誰に向くか）を明確にしたMarkdown記事を書いてください。広告表記、箇条書き、FAQ(3問)を含めること。";
  const user =
    `商品名: ${input.productName}\n` +
    `ASIN: ${input.asin}\n` +
    `サイト: ${input.siteId}\n` +
    `出力: # 見出し / ココが刺さる人 / 強み3つ / どこで買う？(Amazonリンク) / FAQ / まとめ`;
  return {
    sys,
    user,
  };
}
