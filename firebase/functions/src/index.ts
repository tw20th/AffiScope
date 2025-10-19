/* env (ローカルのみ) */
(async () => {
  try {
    if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
      await import("dotenv/config");
    }
  } catch {}
})();

/* Firebase Admin */
import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
if (getApps().length === 0) initializeApp();

const REGION = "asia-northeast1";

/* Healthcheck */
export const health = functions
  .region(REGION)
  .https.onRequest((_req, res) => res.status(200).send("ok"));

/* ---- HTTP ---- */
export { trackClick } from "./http/trackClick.js";
export { debugSiteInventory, runSeedQueue } from "./http/queueTools.js";
export { debugRateLimits } from "./http/rateDebug.js";

/* ---- Jobs / Queues ---- */
export {
  scheduledDiscoverProducts,
  runDiscoverNow,
} from "./jobs/discoverProducts.js";

export {
  scheduledProcessAsinQueue,
  runProcessAsinQueue,
} from "./jobs/processAsinQueue.js";

export { scheduledUpdatePrices, runUpdatePrices } from "./jobs/updatePrices.js";
export {
  runQueueHousekeeping,
  globalCooldown,
} from "./jobs/queueHousekeeping.js";

/* ---- Blogs: publish hook ---- */
export { onPublishBlog } from "./jobs/publishBlog.js";

/* ---- Blogs: daily generator (朝/昼を1ファイルで) ----
   ※ 新ファイル: ./jobs/scheduledBlogDaily.ts に実装
*/
export {
  scheduledBlogMorning,
  scheduledBlogNoon,
} from "./jobs/scheduledBlogDaily.js";

/* ---- Blogs: GSC 連動生成（ファイル名を整理） ----
   ※ 新ファイル名: ./jobs/seo/generateFromGSC.ts
   後方互換のため、旧エイリアスもエクスポート
*/
export {
  generateFromGSC,
  runGenerateFromGscNow,
  // 旧名の互換エクスポート（既存のcurlやCIを壊さない）
  generateFromGSC as scheduledBlogFromGSC,
  runGenerateFromGscNow as runBlogFromGscNow,
} from "./jobs/seo/generateFromGSC.js";

/* ---- Blogs: リライト ---- */
export { scheduledRewriteLowScoreBlogs } from "./jobs/scheduledRewriteLowScoreBlogs.js";

/* ---- Blogs: 週次ピラー ---- */
export { scheduledWeeklyPillar } from "./jobs/scheduledWeeklyPillar.js";

/* ---- GSC 取得 ---- */
export { scheduledPullGsc, runPullGscNow } from "./jobs/seo/pullGscQueries.js";

/* ---- Pick & Generate（手動運用が残るなら） ----
   ※ 役割がDailyと被るため縮小/廃止候補だが、
      後方互換のため当面は残す
*/
export { pickAndGenerateDaily } from "./jobs/pickAndGenerate.js";

/* ---- 補助スケジュール ---- */
import { requeueDeadLetters } from "./scripts/retryDeadLetter.js";

export const scheduledEnqueueStale = functions
  .region(REGION)
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const focus = process.env.FOCUS_SITE_ID || "";
    if (!focus) {
      console.warn("[scheduledEnqueueStale] FOCUS_SITE_ID empty. Skip.");
      return;
    }
    const { enqueueStaleBySite } = await import(
      "./scripts/enqueueStaleProducts.js"
    );
    await enqueueStaleBySite(focus, 800);
  });

export const scheduledRetryDeadLetters = functions
  .region(REGION)
  .pubsub.schedule("every 24 hours")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    await requeueDeadLetters(1000);
  });

/* ---- env dump ---- */
export const envDump = functions.region(REGION).https.onRequest((_req, res) => {
  res.json({
    QUEUE_BATCH_SIZE: process.env.QUEUE_BATCH_SIZE,
    PAAPI_CHUNK_SIZE: process.env.PAAPI_CHUNK_SIZE,
    PAAPI_INTERVAL_MS: process.env.PAAPI_INTERVAL_MS,
    PAAPI_RETRIES: process.env.PAAPI_RETRIES,
    PAAPI_BACKOFF_BASE: process.env.PAAPI_BACKOFF_BASE,
    PAAPI_JITTER: process.env.PAAPI_JITTER,
    PAAPI_COOLDOWN_MS: process.env.PAAPI_COOLDOWN_MS,
    PAAPI_TPS: process.env.PAAPI_TPS,
    PAAPI_BURST: process.env.PAAPI_BURST,
    PAAPI_TPD: process.env.PAAPI_TPD,
    FOCUS_SITE_ID: process.env.FOCUS_SITE_ID,
    ALLOW_MANUAL_QUEUE_RUN: process.env.ALLOW_MANUAL_QUEUE_RUN,
  });
});
