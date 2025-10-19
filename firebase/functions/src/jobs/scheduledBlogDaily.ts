// firebase/functions/src/jobs/scheduledBlogDaily.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";
import {
  appendPainCTASection,
  buildMorningMessages,
  buildNoonMessages,
} from "../lib/prompts/blogPrompts.js";
import {
  pickRecentUpdated,
  pickRecentCreated,
} from "../lib/pickers/products.js";
import { dailySlug } from "../lib/slug/daily.js";
import { getBlogEnabledSiteIds } from "../lib/sites.js";

const REGION = "asia-northeast1";
const db = getFirestore();
let _openai: OpenAI | null = null;
const openai = () =>
  (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }));

async function generate(siteId: string, mode: "morning" | "noon") {
  const cand =
    mode === "morning"
      ? await pickRecentUpdated(siteId) // updatedAt優先
      : await pickRecentCreated(siteId); // createdAt優先

  if (!cand) return { siteId, created: 0 };

  const p = cand.data() as {
    asin: string;
    productName?: string;
    name?: string;
    imageUrl?: string | null;
    categoryId?: string;
  };
  const asin = p.asin;
  const titleBase = mode === "morning" ? "値下げ情報" : "レビューまとめ";
  const mdBuilder =
    mode === "morning" ? buildMorningMessages : buildNoonMessages;

  const slug = dailySlug(siteId, asin);
  if ((await db.collection("blogs").doc(slug).get()).exists)
    return { siteId, created: 0 };

  const { sys, user } = await mdBuilder({
    siteId,
    asin,
    productName: p.productName ?? p.name ?? "(no name)",
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
    `# ${p.productName ?? p.name ?? "(no name)"} ${titleBase}`;
  const content = await appendPainCTASection(siteId, raw);

  const now = Date.now();
  await db
    .collection("blogs")
    .doc(slug)
    .set({
      slug,
      siteId,
      status: "published",
      title: `${p.productName ?? p.name ?? "(no name)"} ${titleBase}`,
      summary: null,
      content,
      imageUrl: p.imageUrl ?? null,
      tags: [
        mode === "morning" ? "値下げ" : "レビュー",
        p.categoryId ?? "misc",
      ],
      relatedAsin: asin,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      views: 0,
    });

  return { siteId, created: 1 };
}

export const scheduledBlogMorning = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
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
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 12 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const ids = await getBlogEnabledSiteIds(db);
    const results = [];
    for (const id of ids) results.push(await generate(id, "noon"));
    return { results };
  });
