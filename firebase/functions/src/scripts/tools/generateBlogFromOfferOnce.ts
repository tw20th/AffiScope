// firebase/functions/src/scripts/tools/generateBlogFromOfferOnce.ts
import "dotenv/config";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { generateBlogFromOffer } from "../../jobs/content/generateBlogFromOffer.js";

// Admin 初期化
if (getApps().length === 0) initializeApp();
const db = getFirestore();

const argv = yargs(hideBin(process.argv))
  .option("site", {
    type: "string",
    demandOption: true,
    desc: "siteId e.g. kariraku",
  })
  .option("offer", {
    type: "string",
    demandOption: true,
    desc: "offerId (offers/{id})",
  })
  .option("dryRun", { type: "boolean", default: false })
  .help()
  .parseSync();

(async () => {
  const { site, offer, dryRun } = argv;
  console.log("[start]", { site, offer, dryRun });

  // 存在チェック（任意）
  const offerSnap = await db.collection("offers").doc(offer).get();
  if (!offerSnap.exists) {
    throw new Error(`offers/${offer} not found`);
  }

  const res = await generateBlogFromOffer({
    siteId: site,
    offerId: offer,
    dryRun,
  });

  console.log("[done]", res);
  process.exit(0);
})();
