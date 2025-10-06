// firebase/functions/src/jobs/scheduledBlogNoon.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";

const REGION = "asia-northeast1";
const db = getFirestore();

/** 遅延初期化 */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (runtime).");
  return (_openai ??= new OpenAI({ apiKey: key }));
}

function dailySlug(siteId: string, asin: string, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `price-drop-${siteId}_${asin}-${y}${m}${d}`;
}

async function createBlog(
  siteId: string,
  asin: string,
  productName: string,
  imageUrl: string | null,
  slug: string
) {
  const openai = getOpenAI();
  const sys =
    "あなたは日本語のSEOライターです。朝記事とは重複しない観点で、用途別（誰に向くか）を明確にしたMarkdown記事を書いてください。広告表記、箇条書き、FAQ(3問)を含めること。";
  const user =
    `商品名: ${productName}\nASIN: ${asin}\nサイト: ${siteId}\n` +
    `出力: # 見出し / ココが刺さる人 / 強み3つ / どこで買う？(Amazonリンク) / FAQ / まとめ`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  const content =
    resp.choices[0]?.message?.content?.trim() ||
    `# ${productName} 評判/レビューまとめ`;
  const nowTs = Date.now();

  await db
    .collection("blogs")
    .doc(slug)
    .set(
      {
        slug,
        siteId,
        status: "published",
        title: `${productName} レビューまとめ`,
        summary: null,
        content,
        imageUrl,
        tags: ["レビュー", "まとめ"],
        relatedAsin: asin,
        createdAt: nowTs,
        updatedAt: nowTs,
        publishedAt: nowTs,
        views: 0,
      },
      { merge: false }
    );

  console.log(`[noon] created blogs/${slug}`);
  return { created: 1 };
}

async function generateOneNewBlog() {
  // 昼は「未掲載の新顔」を少し優先
  const s = await db
    .collection("products")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  const candidate = s.docs.find(Boolean);
  if (!candidate) return { created: 0 };

  const p = candidate.data() as any;
  const asin = p.asin as string;
  const siteId = p.siteId as string;
  const productName = p.productName ?? p.name ?? "(no name)";
  const slug = dailySlug(siteId, asin);

  const exists = await db.collection("blogs").doc(slug).get();
  if (exists.exists) {
    console.log(`[noon] already exists ${slug}, fallback to updatedAt pick.`);
    // フォールバック: updatedAt desc から1件
    const f = await db
      .collection("products")
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();
    const alt = f.docs.find(Boolean);
    if (!alt) return { created: 0 };
    const ap = alt.data() as any;
    const as = ap.asin as string;
    const st = ap.siteId as string;
    const sl = dailySlug(st, as);
    const ex = await db.collection("blogs").doc(sl).get();
    if (ex.exists) return { created: 0 };
    return createBlog(
      st,
      as,
      ap.productName ?? ap.name ?? "(no name)",
      ap.imageUrl ?? null,
      sl
    );
  }

  return createBlog(siteId, asin, productName, p.imageUrl ?? null, slug);
}

export const scheduledBlogNoon = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 12 * * *") // JST 12:00
  .timeZone("Asia/Tokyo")
  .onRun(async () => generateOneNewBlog());
