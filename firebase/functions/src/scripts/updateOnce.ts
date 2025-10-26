// firebase/functions/src/scripts/updateOnce.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { updatePricesForSite } from "../jobs/products/updatePrices.js";

// Firebase Admin 初期化
if (getApps().length === 0) initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function main() {
  // 使い方: tsx src/scripts/updateOnce.ts [siteId] [limit]
  const [siteIdArg, limitArg] = process.argv.slice(2);
  const limit = Math.min(Math.max(Number(limitArg) || 50, 1), 100);

  if (siteIdArg) {
    const res = await updatePricesForSite(siteIdArg, limit);
    console.log("updatePricesForSite:", res);
    return;
  }

  // 引数が無ければ全サイトを一巡
  const sites = await db.collection("sites").get();
  for (const sd of sites.docs) {
    try {
      const res = await updatePricesForSite(sd.id, limit);
      console.log("updatePricesForSite:", res);
    } catch (e) {
      console.error("updatePricesForSite failed:", sd.id, e);
    }
  }
}

main()
  .then(() => {
    console.log("updateOnce: done");
    process.exit(0);
  })
  .catch((e) => {
    console.error("updateOnce: failed", e);
    process.exit(1);
  });
