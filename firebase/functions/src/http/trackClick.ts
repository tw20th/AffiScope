// firebase/functions/src/http/trackClick.ts
import * as functions from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
      const { asin } = body as { asin: string; source?: "amazon" | "rakuten" };
      if (!asin) {
        res.status(400).send("bad request");
        return;
      }

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
