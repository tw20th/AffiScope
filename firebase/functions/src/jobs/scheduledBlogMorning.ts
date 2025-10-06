// firebase/functions/src/jobs/scheduledBlogMorning.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";

const REGION = "asia-northeast1";
const db = getFirestore();

/** OpenAI クライアントは遅延生成（デプロイ時の Missing credentials 回避） */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (runtime).");
  return (_openai ??= new OpenAI({ apiKey: key }));
}

/** 日付付きslug（上書き防止） */
function dailySlug(siteId: string, asin: string, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `price-drop-${siteId}_${asin}-${y}${m}${d}`;
}

/** 朝：1件だけ新規記事を生成して公開 */
async function generateOneNewBlog() {
  const now = Date.now();

  // 候補: 24h → 7d → 全体 updatedAt desc
  const windows = [24, 24 * 7];
  let cand: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (const h of windows) {
    const s = await db
      .collection("products")
      .where("updatedAt", ">=", now - h * 3600 * 1000)
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();
    cand = s.docs.find(Boolean) ?? null;
    if (cand) break;
  }
  if (!cand) {
    const s = await db
      .collection("products")
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();
    cand = s.docs.find(Boolean) ?? null;
  }
  if (!cand) {
    console.log("[morning] no candidates.");
    return { created: 0 };
  }

  const p = cand.data() as any;
  const asin = p.asin as string;
  const siteId = p.siteId as string;
  const productName = p.productName ?? p.name ?? "(no name)";
  const slug = dailySlug(siteId, asin);

  // 今日のslugが既にあればスキップ
  const exists = await db.collection("blogs").doc(slug).get();
  if (exists.exists) {
    console.log(`[morning] already exists ${slug}, skip.`);
    return { created: 0 };
  }

  // 生成（OpenAI はここで初期化）
  const openai = getOpenAI();
  const sys =
    "あなたは日本語のSEOライターです。商品名と価格情報をもとに、検索意図（値下げ情報/購入検討）に合致した短いブログ記事をMarkdownで書いてください。広告表記、見出し、箇条書き、最後にCTA(公式リンク)を含めること。";
  const user = `商品名: ${productName}\nASIN: ${asin}\nサイト: ${siteId}\nトーン: 誠実・要点を簡潔に\n出力: # 見出し / ポイント3つ / どこで買う？(Amazonリンクだけ) / まとめ`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.3,
  });
  const content =
    resp.choices[0]?.message?.content?.trim() || `# ${productName} 値下げ情報`;

  const nowTs = Date.now();
  await db
    .collection("blogs")
    .doc(slug)
    .set(
      {
        slug,
        siteId,
        status: "published", // 直公開
        title: `${productName} 値下げ情報`,
        summary: null,
        content,
        imageUrl: p.imageUrl ?? null,
        tags: ["値下げ", p.categoryId ?? "misc"],
        relatedAsin: asin,
        createdAt: nowTs,
        updatedAt: nowTs,
        publishedAt: nowTs,
        views: 0,
      },
      { merge: false }
    );

  console.log(`[morning] created blogs/${slug}`);
  return { created: 1 };
}

export const scheduledBlogMorning = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 6 * * *") // JST 06:00
  .timeZone("Asia/Tokyo")
  .onRun(async () => generateOneNewBlog());
