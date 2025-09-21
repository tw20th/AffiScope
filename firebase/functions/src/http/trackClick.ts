import * as functions from "firebase-functions";
// ❌ import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin"; // initialize 用だけ残す（既に index.ts で初期化済みならなくてもOK）

export const trackClick = functions
  .region("asia-northeast1")
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }

    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { asin, source } = body as {
        asin: string;
        source: "amazon" | "rakuten";
      };
      if (!asin || !source) {
        res.status(400).send("bad request");
        return;
      }

      // ✅ Admin Firestore のモジュラー API
      const db = getFirestore();
      await db
        .collection("products")
        .doc(asin)
        .set({ views: FieldValue.increment(1) }, { merge: true });

      res.status(204).end();
    } catch (e) {
      console.error(e);
      res.status(500).send("error");
    }
  });
