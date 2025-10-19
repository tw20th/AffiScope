// pnpm -C firebase/functions exec tsx src/scripts/backfillInStockFromBestPrice.ts <siteId>
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/backfillInStockFromBestPrice.ts <siteId>"
    );
    process.exit(1);
  }

  // まずは siteId で絞る（インデックスが必要ならフォールバック）
  let docs: any[] = [];
  try {
    const snap = await db
      .collection("products")
      .where("siteId", "==", siteId)
      .get();
    docs = snap.docs;
  } catch {
    const all = await db.collection("products").get();
    docs = all.docs.filter((d) => d.get("siteId") === siteId);
  }

  const targets = docs.filter(
    (d) => d.get("bestPrice") && d.get("inStock") !== true
  );
  const BATCH = 400;
  let updated = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = db.batch();
    for (const d of targets.slice(i, i + BATCH)) {
      batch.update(d.ref, {
        inStock: true,
        availability: "in_stock",
        updatedAt: Date.now(),
      });
    }
    await batch.commit();
    updated += Math.min(BATCH, targets.length - i);
  }
  console.log(
    JSON.stringify({ siteId, scanned: docs.length, fixed: updated }, null, 2)
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
