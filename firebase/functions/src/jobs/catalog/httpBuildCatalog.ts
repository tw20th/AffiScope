import * as functions from "firebase-functions";
import { buildCatalogFromRaw } from "./buildCatalogFromRaw.js";

const REGION = "asia-northeast1";

export const runBuildCatalog = functions
  .region(REGION)
  .https.onRequest(async (_req, res) => {
    try {
      const out = await buildCatalogFromRaw(800);
      res.status(200).json({ ok: true, ...out });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      res.status(500).json({ ok: false });
    }
  });
