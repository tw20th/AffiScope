// firebase/functions/src/jobs/scheduledRewriteLowScoreBlogs.ts
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

/** 簡易スコア（0-100） */
function scoreContent(md: string) {
  const len = md?.length ?? 0;
  let s = 50 + Math.min(30, Math.floor(len / 800)); // ボリューム加点
  if (/^#{1,3}\s/m.test(md)) s += 5; // 見出し
  if (/FAQ/i.test(md)) s += 5; // FAQ
  if (/\(https?:\/\/.*?amazon\.co\.jp/.test(md)) s += 5; // 外部/CTA
  if (/\(\/(products|blog)\//.test(md)) s += 5; // 内部リンク
  return Math.max(0, Math.min(100, s));
}

/** 1件リライト */
async function rewriteOne(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() as any;
  const content: string = data.content || "";
  const title: string = data.title || "(no title)";
  const current = scoreContent(content);

  if (current >= 85) {
    console.log(`[rewrite] skip ${doc.id} score=${current}`);
    return { rewritten: false, slug: doc.id, score: current };
  }

  const openai = getOpenAI();
  const sys =
    "あなたは日本語のSEO編集者です。与えられたMarkdown記事を、検索意図（購入前の悩み解決）に沿ってブラッシュアップし、E-E-A-Tを意識しつつCTRが上がるようにリライトしてください。リンクURLは変更しないでください。過剰表現は禁止。";
  const user =
    `タイトル: ${title}\n` +
    `本文(そのままMarkdown):\n\n${content}\n\n` +
    "やること: 1) 導入で悩み→解決のフレーム提示 2) 競合との違いを箇条書き 3) FAQを3つ追加 4) まとめでCTA。";

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  });

  const newMd = resp.choices[0]?.message?.content?.trim() || content;
  const after = scoreContent(newMd);

  await doc.ref.set(
    {
      content: newMd,
      updatedAt: Date.now(),
      analysisHistory: [
        ...(data.analysisHistory ?? []),
        { before: current, after, updatedAt: Date.now(), note: "auto-rewrite" },
      ],
    },
    { merge: true }
  );

  console.log(`[rewrite] ${doc.id} ${current}→${after}`);
  return { rewritten: true, slug: doc.id, before: current, after };
}

export const scheduledRewriteLowScoreBlogs = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 23 * * *") // JST 23:00
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    // published の中からスコアが低そうな候補を上位にし、1件だけリライト
    const snap = await db
      .collection("blogs")
      .where("status", "==", "published")
      .orderBy("updatedAt", "asc")
      .limit(30)
      .get();

    const candidates = snap.docs
      .map((d) => ({
        d,
        s: scoreContent(((d.data() as any).content as string) || ""),
      }))
      .sort((a, b) => a.s - b.s);

    const target = candidates[0]?.d;
    if (!target) {
      console.log("[rewrite] no target.");
      return null;
    }
    return rewriteOne(target);
  });
