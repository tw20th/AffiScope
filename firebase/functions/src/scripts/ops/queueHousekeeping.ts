// firebase/functions/src/scripts/queueHousekeeping.ts
import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const REGION = "asia-northeast1";
const PROCESSING_TTL_MS = 15 * 60 * 1000; // 15分

export const runQueueHousekeeping = functions
  .region(REGION)
  .https.onRequest(async (_req, res) => {
    try {
      const now = Date.now();
      const cutoff = now - PROCESSING_TTL_MS;

      // processing かつ updatedAt が古いもの
      const snap = await db
        .collection("asinQueue")
        .where("status", "==", "processing")
        .where("updatedAt", "<=", cutoff)
        .limit(500)
        .get();

      if (snap.empty) return void res.json({ ok: true, healed: 0 });

      const batch = db.batch();
      let healed = 0;
      snap.forEach((d) => {
        batch.update(d.ref, {
          status: "queued",
          // ロック時に +1 した attempts を戻しておくと再挑戦しやすい
          attempts: FieldValue.increment(-1),
          updatedAt: now,
          error: "housekeeping: restored from stale processing",
        } as any);
        healed++;
      });
      await batch.commit();
      res.json({ ok: true, healed });
    } catch (e: any) {
      console.error("[runQueueHousekeeping] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
