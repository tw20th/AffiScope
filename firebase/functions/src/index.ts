/* env (local only) */
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

/* ---- Health ---- */
export const health = functions.region(REGION).https.onRequest((_req, res) => {
  res.status(200).send("ok");
});

/* ---- HTTP（計測/運用系） ---- */
export { trackClick } from "./http/trackClick.js";

/* ---- Rakuten: 手動ツール（HTTPトリガ） ---- */
export { runSeedRakuten, runUpdateRakuten } from "./http/rakutenTools.js";
export { runRakutenIngestNow } from "./jobs/products/scheduledRakutenIngest.js";
export { runEnrichRakutenNow } from "./jobs/products/enrichRakuten.js";

/* ---- Publish Hook ---- */
export { onPublishBlog } from "./jobs/hooks/publishBlog.js";

/* ---- Scheduled / Batch ---- */
export { scheduledDiscoverProducts } from "./jobs/products/discoverProducts.js";
export { scheduledProcessAsinQueue } from "./jobs/products/processAsinQueue.js";
export { scheduledUpdatePrices } from "./jobs/products/updatePrices.js";
export {
  scheduledBlogMorning,
  scheduledBlogNoon,
  scheduledBlogEvening, // ← 追加
} from "./jobs/content/scheduledBlogDaily.js";
export { scheduledWeeklyPillar } from "./jobs/content/scheduledWeeklyPillar.js";
export { scheduledRewriteLowScoreBlogs } from "./jobs/content/scheduledRewriteLowScoreBlogs.js";
export { scheduledPullGsc } from "./jobs/seo/pullGscQueries.js";
export { pickAndGenerateDaily } from "./jobs/products/pickAndGenerate.js";

export {
  runBuildCatalog,
  scheduledBuildCatalog,
} from "./jobs/catalog/buildFromRaw.js";
export { runApplyCatalogRules } from "./jobs/catalog/httpApplyRules.js";
export { runApplyCatalogPains } from "./jobs/catalog/httpApplyPains.js";
export { runGenerateCatalogSummaries } from "./jobs/catalog/httpGenerateSummaries.js";
export { runBlogDailyNow } from "./jobs/content/scheduledBlogDaily.js";

export {
  runProjectAllSites,
  runProjectSite,
} from "./jobs/sites/httpProjectCatalog.js";

/* ---- Rakuten: スケジュール ---- */
export { scheduledRakutenIngest } from "./jobs/products/scheduledRakutenIngest.js";
export { scheduledEnrichRakuten } from "./jobs/products/enrichRakuten.js";

/* ---- 補助スケジュール ---- */
import { requeueDeadLetters } from "./scripts/ops/retryDeadLetter.js";
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
      "./scripts/ops/enqueueStaleProducts.js"
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

import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore();
/** Firestore に undefined を書かない（先日の capacity.mAh エラー対策） */
db.settings({ ignoreUndefinedProperties: true });
