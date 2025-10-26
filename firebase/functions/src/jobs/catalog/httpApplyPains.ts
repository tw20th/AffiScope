import * as functions from "firebase-functions";
import { applyCatalogPainsOnce } from "./applyPains.js";
export const runApplyCatalogPains = functions
  .region("asia-northeast1")
  .https.onRequest(async (_req, res) => {
    try {
      const out = await applyCatalogPainsOnce();
      res.json({ ok: true, ...out });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
