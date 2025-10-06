// firebase/functions/src/index.ts
// ✅ 本番(GCF)では dotenv を読み込まない。ローカル(エミュ/tsx)のみ読み込む
(async () => {
  try {
    if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
      await import("dotenv/config");
    }
  } catch {
    // 本番では dotenv が無くてOK
  }
})();

import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
getFirestore().settings({ ignoreUndefinedProperties: true });

// ⚠️ 戻り値を返さない（void）形にする
export const health = functions
  .region("asia-northeast1")
  .https.onRequest((_req, res) => {
    res.status(200).send("ok");
  });

export { trackClick } from "./http/trackClick.js";
export { scheduledUpdatePrices, runUpdatePrices } from "./jobs/updatePrices.js";
export { onPublishBlog } from "./jobs/publishBlog.js";
export { pickAndGenerateDaily } from "./jobs/pickAndGenerate.js";
export {
  scheduledDiscoverProducts,
  scheduledDiscoverFromSearch,
  runDiscoverNow,
} from "./jobs/discoverProducts.js";

export {
  scheduledProcessAsinQueue,
  runProcessAsinQueue,
} from "./jobs/processAsinQueue.js";

export { scheduledBlogMorning } from "./jobs/scheduledBlogMorning.js";
export { scheduledBlogNoon } from "./jobs/scheduledBlogNoon.js";
export { scheduledRewriteLowScoreBlogs } from "./jobs/scheduledRewriteLowScoreBlogs.js";

export { runBackfillBlogSiteId } from "./scripts/backfillBlogSiteId.js";
