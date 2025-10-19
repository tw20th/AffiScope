// firebase/functions/src/http/rateDebug.ts
import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

export const debugRateLimits = functions
  .region("asia-northeast1")
  .https.onRequest(async (_req, res) => {
    try {
      const docs = await db.collection("rateLimits").get();
      res.json({
        ok: true,
        items: docs.docs.map((d) => ({ id: d.id, ...d.data() })),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
