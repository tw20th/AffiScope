// firebase/functions/src/index.ts
(async () => {
  try {
    if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
      await import("dotenv/config");
    }
  } catch {}
})();

import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
// ここでは getFirestore は使わず、共有の db を使う
import { db } from "./lib/db.js";

if (getApps().length === 0) initializeApp();
// ⚠ settings() は呼ばない！ ignoreUndefined は書き込み前のサニタイズで対応する

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
export { scheduledWeeklyPillar } from "./jobs/scheduledWeeklyPillar.js";

// ★ 追加: 鮮度ベース再投入 & DLQリトライ
import { enqueueStaleBySite } from "./scripts/enqueueStaleProducts.js";
import { requeueDeadLetters } from "./scripts/retryDeadLetter.js";

const REGION = "asia-northeast1";

export const scheduledEnqueueStale = functions
  .region(REGION)
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const sites = await db.collection("sites").get();
    for (const s of sites.docs) await enqueueStaleBySite(s.id, 800);
  });

export const scheduledRetryDeadLetters = functions
  .region(REGION)
  .pubsub.schedule("every 24 hours")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    await requeueDeadLetters(1000);
  });
