// firebase/functions/src/jobs/scheduledBlogNoon.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";
import {
  appendPainCTASection,
  buildNoonMessages,
} from "../firebase/functions/src/lib/prompts/blogPrompts.js";

const REGION = "asia-northeast1";
const db = getFirestore();

/** 遅延初期化 */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (runtime).");
  return (_openai ??= new OpenAI({ apiKey: key }));
}

async function getBlogEnabledSiteIds(): Promise<string[]> {
  const snap = await db
    .collection("sites")
    .where("features.blogs", "==", true)
    .get();
  return snap.docs
    .map((d) => (d.data() as { siteId?: string }).siteId!)
    .filter(Boolean);
}

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
  createdAt?: number;
  updatedAt?: number;
};

async function createBlog(
  siteId: string,
  asin: string,
  productName: string,
  imageUrl: string | null,
  slug: string
) {
  const openai = getOpenAI();
  const { sys, user } = await buildNoonMessages({ siteId, asin, productName });

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  const raw =
    resp.choices[0]?.message?.content?.trim() ||
    `# ${productName} 評判/レビューまとめ`;
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
  return { siteId, created: 1 };
}

async function generateOneNewBlogForSite(siteId: string) {
  // 昼は「未掲載の新顔」を優先（siteId スコープ）
  const s = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const candidate = s.docs[0];
  if (!candidate) return { siteId, created: 0 };

  const p = candidate.data() as ProductDoc;
  const asin = p.asin;
  const productName = p.productName ?? p.name ?? "(no name)";
  const slug = dailySlug(siteId, asin);

  const exists = await db.collection("blogs").doc(slug).get();
  if (exists.exists) {
    console.log(`[noon] already exists ${slug}, fallback by updatedAt.`);
    const f = await db
      .collection("products")
      .where("siteId", "==", siteId)
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();
    const alt = f.docs[0];
    if (!alt) return { siteId, created: 0 };
    const ap = alt.data() as ProductDoc;
    const as = ap.asin;
    const sl = dailySlug(siteId, as);
    const ex = await db.collection("blogs").doc(sl).get();
    if (ex.exists) return { siteId, created: 0 };
    return createBlog(
      siteId,
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
  .onRun(async () => {
    const siteIds = await getBlogEnabledSiteIds();
    const results = [];
    for (const siteId of siteIds) {
      results.push(await generateOneNewBlogForSite(siteId));
    }
    return { results };
  });
