import * as functions from "firebase-functions";
import {
  projectAllSites,
  projectCatalogForSite,
} from "./projectCatalogToSite.js";

const REGION = "asia-northeast1";

export const runProjectAllSites = functions
  .region(REGION)
  .https.onRequest(async (_req, res) => {
    try {
      const out = await projectAllSites(1200);
      res.json({ ok: true, results: out });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

export const runProjectSite = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "");
      if (!siteId) {
        res.status(400).json({ ok: false, error: "siteId required" });
        return;
      }
      const limit = Math.max(
        1,
        Math.min(2000, Number(req.query.limit ?? 1000))
      );
      const out = await projectCatalogForSite(siteId, limit);
      res.json({ ok: true, ...out });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
