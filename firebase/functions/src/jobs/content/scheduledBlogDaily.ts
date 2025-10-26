// firebase/functions/src/jobs/content/scheduledBlogDaily.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { getOpenAI } from "../../lib/infra/openai.js";
import {
  appendPainCTASection,
  buildMorningMessages,
  buildNoonMessages,
} from "../../lib/content/prompts/blogPrompts.js";

// monitoredItems ベースのピッカー
import {
  pickHotCandidate,
  pickRecentUpdated,
  pickRecentCreated,
} from "../../lib/pickers/monitored.js";
import { dailySlug } from "../../lib/slug/daily.js";
import { getBlogEnabledSiteIds } from "../../lib/sites/sites.js";

// ← 追加：Unsplash クライアント
import { findUnsplashHero } from "../../services/unsplash/client.js";

const REGION = "asia-northeast1";
const db = getFirestore();
const openai = () => getOpenAI();

async function generate(siteId: string, mode: "morning" | "noon") {
  // ★ 基本はスコアで選ぶ。なければ従来のフォールバック
  let cand = await pickHotCandidate(siteId, db);
  if (!cand) {
    cand =
      mode === "morning"
        ? await pickRecentUpdated(siteId, db)
        : await pickRecentCreated(siteId, db);
  }

  if (!cand) return { siteId, created: 0 };

  const p = cand.data() as {
    productId?: string; // monitoredItems のキー
    productName?: string;
    name?: string;
    imageUrl?: string | null;
    category?: string | null;
  };

  const productKey = p.productId ?? cand.id; // asin 互換キー
  const productName = p.productName ?? p.name ?? "(no name)";
  const titleBase = mode === "morning" ? "値下げ情報" : "レビューまとめ";
  const mdBuilder =
    mode === "morning" ? buildMorningMessages : buildNoonMessages;

  const slug = dailySlug(siteId, productKey);
  if ((await db.collection("blogs").doc(slug).get()).exists) {
    return { siteId, created: 0 };
  }

  const { sys, user } = await mdBuilder({
    siteId,
    asin: productKey, // プロンプト互換
    productName,
  });

  const resp = await openai().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const raw =
    resp.choices[0]?.message?.content?.trim() ||
    `# ${productName} ${titleBase}`;

  const content = await appendPainCTASection(siteId, raw);

  // --- ここが Unsplash フォールバック ---
  // 1) monitoredItems の imageUrl を優先
  // 2) それが空なら Unsplash から 1枚検索してセット
  let heroImageUrl: string | null = p.imageUrl ?? null;
  let imageCredit: string | null = null;
  let imageCreditLink: string | null = null;

  if (!heroImageUrl) {
    // クエリは「サイト名 + 製品名」をベースに（椅子/電源などカテゴリに寄せるため）
    const hero = await findUnsplashHero(`${siteId} ${productName}`);
    if (hero?.url) {
      heroImageUrl = hero.url;
      imageCredit = hero.credit || null;
      imageCreditLink = hero.creditLink || null;
    }
  }

  const now = Date.now();
  await db
    .collection("blogs")
    .doc(slug)
    .set(
      {
        slug,
        siteId,
        status: "published",
        title: `${productName} ${titleBase}`,
        summary: null,
        content,
        imageUrl: heroImageUrl, // ← ここに反映
        imageCredit: imageCredit || null, // （任意）テンプレで使いたければ
        imageCreditLink: imageCreditLink || null,
        tags: [
          mode === "morning" ? "値下げ" : "レビュー",
          p.category ?? "misc",
        ],
        relatedAsin: productKey, // 互換フィールド
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
        views: 0,
      },
      { merge: true }
    );

  return { siteId, created: 1 };
}

// すべてのスケジュールで Unsplash の Secret も投入
export const scheduledBlogMorning = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY", "UNSPLASH_ACCESS_KEY"] })
  .pubsub.schedule("0 6 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const ids = await getBlogEnabledSiteIds(db);
    const results = [];
    for (const id of ids) results.push(await generate(id, "morning"));
    return { results };
  });

export const scheduledBlogNoon = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY", "UNSPLASH_ACCESS_KEY"] })
  .pubsub.schedule("0 12 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const ids = await getBlogEnabledSiteIds(db);
    const results = [];
    for (const id of ids) results.push(await generate(id, "noon"));
    return { results };
  });

/** 夕方（powerscope も含め、features.blogs=true の全サイト対象） */
export const scheduledBlogEvening = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY", "UNSPLASH_ACCESS_KEY"] })
  .pubsub.schedule("0 18 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const ids = await getBlogEnabledSiteIds(db);
    const results = [];
    for (const id of ids) results.push(await generate(id, "noon"));
    return { results };
  });

// 手動トリガ（検証用）
export const runBlogDailyNow = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY", "UNSPLASH_ACCESS_KEY"] })
  .https.onRequest(async (req, res) => {
    const siteId = String(req.query.siteId || "");
    const mode = String(req.query.mode || "morning") as "morning" | "noon";

    if (!siteId) {
      res.status(400).json({ ok: false, error: "siteId required" });
      return;
    }

    const out = await generate(siteId, mode);
    res.json({ ok: true, ...out });
  });
