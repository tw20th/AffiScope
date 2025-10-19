// firebase/functions/src/http/gscPull.ts
import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const REGION = "asia-northeast1";

export const runPullGscNow = functions
  .runWith({
    secrets: ["GSC_SA_JSON"],
    timeoutSeconds: 120,
    memory: "512MB",
  })
  .region(REGION)
  .https.onRequest(async (req, res): Promise<void> => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      if (!siteId) {
        res.status(400).json({ ok: false, error: "siteId is required" });
        return;
      }

      // （いまはモック書き込み。後で本番のGSC取得に差し替え）
      const now = Date.now();
      await db
        .collection("sites")
        .doc(siteId)
        .collection("seo")
        .doc("latest")
        .set({
          rows: [
            {
              query: "サンプル クエリ",
              impressions: 123,
              ctr: 0.15,
              position: 4.3,
            },
          ],
          updatedAt: now,
        });

      res.json({
        ok: true,
        siteId,
        message: "GSC mock data stored successfully.",
      });
    } catch (e: any) {
      console.error("[runPullGscNow] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
