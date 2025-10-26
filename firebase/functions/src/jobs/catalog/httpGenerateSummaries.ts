import * as functions from "firebase-functions";
import { generateCatalogSummariesOnce } from "./generateAiSummaries.js";
export const runGenerateCatalogSummaries = functions
  .region("asia-northeast1")
  .https.onRequest(async (_req, res) => {
    try {
      const out = await generateCatalogSummariesOnce();
      res.json({ ok: true, ...out });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
