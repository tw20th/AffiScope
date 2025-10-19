// firebase/functions/src/jobs/scheduledBlogMorning.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";
import {
  appendPainCTASection,
  buildMorningMessages,
} from "../firebase/functions/src/lib/prompts/blogPrompts.js";

const REGION = "asia-northeast1";
const db = getFirestore();

/** OpenAI クライアントは遅延生成（デプロイ時の Missing credentials 回避） */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (runtime).");
  return (_openai ??= new OpenAI({ apiKey: key }));
}

/** Firestore の sites コレクションから、blogs 機能が有効な siteId を取得 */
async function getBlogEnabledSiteIds(): Promise<string[]> {
  const snap = await db
    .collection("sites")
    .where("features.blogs", "==", true)
    .get();
  return snap.docs
    .map((d) => (d.data() as { siteId?: string }).siteId!)
    .filter(Boolean);
}

/** 日付付きslug（上書き防止） */
function dailySlug(siteId: string, asin: string, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `price-drop-${siteId}_${asin}-${y}${m}${d}`;
}

type ProductDoc = {
  asin: string;
  siteId: string;
  productName?: string;
  name?: string;
  imageUrl?: string | null;
  categoryId?: string;
  updatedAt?: number;
};

async function pickCandidateForSite(siteId: string) {
  const now = Date.now();
  const windows = [24, 24 * 7];

  for (const h of windows) {
    const s = await db
      .collection("products")
      .where("siteId", "==", siteId)
      .where("updatedAt", ">=", now - h * 3600 * 1000)
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();

    const cand = s.docs[0];
    if (cand) return cand;
  }

  const s = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("updatedAt", "desc")
    .limit(10)
    .get();

  return s.docs[0] ?? null;
}

/** 朝：サイトごとに1件だけ新規記事を生成して公開 */
async function generateOneNewBlogForSite(siteId: string) {
  const cand = await pickCandidateForSite(siteId);
  if (!cand) {
    console.log(`[morning] no candidates for site=${siteId}`);
    return { siteId, created: 0 };
  }

  const p = cand.data() as ProductDoc;
  const asin = p.asin;
  const productName = p.productName ?? p.name ?? "(no name)";
  const slug = dailySlug(siteId, asin);

  // 今日のslugが既にあればスキップ
  const exists = await db.collection("blogs").doc(slug).get();
  if (exists.exists) {
    console.log(`[morning] already exists ${slug}, skip.`);
    return { siteId, created: 0 };
  }

  const openai = getOpenAI();
  const { sys, user } = await buildMorningMessages({
    siteId,
    asin,
    productName,
  });

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.3,
  });

  // 本文 + 関連ガイド（悩みボタンのショートコード）
  const raw =
    resp.choices[0]?.message?.content?.trim() || `# ${productName} 値下げ情報`;
  const content = await appendPainCTASection(siteId, raw);

  const nowTs = Date.now();
  await db
    .collection("blogs")
    .doc(slug)
    .set(
      {
        slug,
        siteId,
        status: "published",
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
  return { siteId, created: 1 };
}

export const scheduledBlogMorning = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 6 * * *") // JST 06:00
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const siteIds = await getBlogEnabledSiteIds();
    const results = [];
    for (const siteId of siteIds) {
      results.push(await generateOneNewBlogForSite(siteId));
    }
    return { results };
  });
