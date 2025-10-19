// firebase/functions/src/http/queueTools.ts
import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/**
 * サイトの在庫状況を可視化：
 * - asinQueue の status 別件数（queued / processing / done / failed）
 * - products の件数
 * 例: GET /debugSiteInventory?siteId=powerbank-scope
 */
export const debugSiteInventory = functions
  .region("asia-northeast1")
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      if (!siteId) {
        res.status(400).json({ ok: false, error: "siteId is required" });
        return;
      }

      const statuses = ["queued", "processing", "done", "failed"] as const;
      const counts: Record<string, number> = {};
      for (const st of statuses) {
        const snap = await db
          .collection("asinQueue")
          .where("siteId", "==", siteId)
          .where("status", "==", st)
          .limit(2000) // カウント用の簡易上限（必要に応じて増やす）
          .get();
        counts[st] = snap.size;
      }

      const prodSnap = await db
        .collection("products")
        .where("siteId", "==", siteId)
        .limit(5000)
        .get();

      // サンプルも少し返す（目視デバッグ向け）
      const sampleQueued = await db
        .collection("asinQueue")
        .where("siteId", "==", siteId)
        .where("status", "==", "queued")
        .orderBy("updatedAt", "asc")
        .limit(5)
        .get();

      res.json({
        ok: true,
        siteId,
        asinQueue: counts,
        productsCount: prodSnap.size,
        sampleQueued: sampleQueued.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })),
      });
    } catch (e: any) {
      console.error("[debugSiteInventory] failed:", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

/**
 * ASIN をキュー投入（既存でも強制的に queued に戻す）
 * 使い方:
 *  - クエリ:  GET /runSeedQueue?siteId=powerbank-scope&asins=B0Cxxxxxxx,B0Dyyyyyyy
 *  - seeds から: GET /runSeedQueue?siteId=powerbank-scope  （sites/<siteId>.json の seeds.asins を使用）
 */
export const runSeedQueue = functions
  .region("asia-northeast1")
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || req.body?.siteId || "").trim();
      if (!siteId) {
        res.status(400).json({ ok: false, error: "siteId is required" });
        return;
      }

      // asins 指定があればそれを使う。無ければ site 設定(seeds.asins)を読む
      let asins: string[] = [];
      const asinsParam =
        (req.query.asins as string | undefined) ||
        (req.body?.asins as string | undefined);

      if (asinsParam) {
        asins = asinsParam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length === 10);
      } else {
        // Firestore の sites コレクションから seeds を読む想定（getSiteConfig が使えないので軽量に）
        const siteDoc = await db.collection("sites").doc(siteId).get();
        const seeds =
          (siteDoc.get("seeds.asins") as string[] | undefined) || [];
        asins = seeds.filter((s) => typeof s === "string" && s.length === 10);
      }

      if (!asins.length) {
        res.status(400).json({
          ok: false,
          error: "no ASINs provided and no seeds found in site config",
        });
        return;
      }

      const now = Date.now();
      const batch = db.batch();

      for (const asin of asins) {
        const id = `${siteId}_${asin}`; // 重複を避けるためキーを固定化
        const ref = db.collection("asinQueue").doc(id);
        batch.set(
          ref,
          {
            siteId,
            asin,
            status: "queued",
            priority: 0,
            attempts: 0,
            createdAt: now,
            updatedAt: now, // クールダウン管理と整合
          },
          { merge: true }
        );
      }

      await batch.commit();
      res.json({ ok: true, siteId, seeded: asins.length, asins });
    } catch (e: any) {
      console.error("[runSeedQueue] failed:", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
