import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";

import {
  buildMorningMessages as buildMorning,
  buildNoonMessages as buildNoon,
  appendPainCTASection,
} from "../lib/content/prompts/blogPrompts.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const REGION = "asia-northeast1";

/** 1) プロンプトを確認（OpenAIは呼ばない） */
export const debugBuildPrompt = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      const asin = String(req.query.asin || "").trim();
      const productName = String(req.query.productName || "").trim();
      const intent = String(req.query.intent || "morning")
        .trim()
        .toLowerCase() as "morning" | "noon";

      if (!siteId || !asin || !productName) {
        return void res
          .status(400)
          .json({ ok: false, error: "siteId, asin, productName are required" });
      }

      const pick =
        intent === "morning"
          ? await buildMorning({ siteId, asin, productName })
          : await buildNoon({ siteId, asin, productName });

      // 参考までに latest の上位5クエリも同梱
      const latest = await db
        .collection("sites")
        .doc(siteId)
        .collection("seo")
        .doc("latest")
        .get();
      const rows =
        ((latest.data()?.rows as any[]) || []).slice(0, 5).map((r) => ({
          query: r.query,
          imp: r.impressions,
          ctr: r.ctr,
          pos: r.position,
        })) || [];

      res.json({
        ok: true,
        intent,
        sys: pick.sys,
        user: pick.user,
        sampleQueries: rows,
      });
    } catch (e: any) {
      console.error("[debugBuildPrompt] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

/** 2) 下書きを実際に1本作ってみる（blogs/draft-... に保存） */
export const generateBlogDraft = functions
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      const asin = String(req.query.asin || "").trim();
      const productName = String(req.query.productName || "").trim();
      const imageUrl = String(req.query.imageUrl || "") || null;
      const intent = String(req.query.intent || "morning")
        .trim()
        .toLowerCase() as "morning" | "noon";

      if (!siteId || !asin || !productName) {
        return void res
          .status(400)
          .json({ ok: false, error: "siteId, asin, productName are required" });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

      const { sys, user } =
        intent === "morning"
          ? await buildMorning({ siteId, asin, productName })
          : await buildNoon({ siteId, asin, productName });

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: intent === "morning" ? 0.3 : 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      });

      const raw =
        resp.choices[0]?.message?.content?.trim() ||
        `# ${productName} ${
          intent === "morning" ? "値下げ情報" : "レビューまとめ"
        }`;

      const content = await appendPainCTASection(siteId, raw);

      const now = Date.now();
      const slug = `draft-${intent}-${siteId}_${asin}-${now}`;

      await db
        .collection("blogs")
        .doc(slug)
        .set(
          {
            slug,
            siteId,
            status: "draft",
            title:
              intent === "morning"
                ? `${productName} 値下げ情報（ドラフト）`
                : `${productName} レビューまとめ（ドラフト）`,
            summary: null,
            content,
            imageUrl,
            tags: intent === "morning" ? ["値下げ"] : ["レビュー", "まとめ"],
            relatedAsin: asin,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
            views: 0,
          },
          { merge: false }
        );

      res.json({ ok: true, slug, intent });
    } catch (e: any) {
      console.error("[generateBlogDraft] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
