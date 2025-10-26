// firebase/functions/src/scripts/migrateAddSiteId.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}
import { getDb } from "../_firestoreClient.js";

const SITE_ID = process.env.SITE_ID ?? "affiscope";

async function main() {
  const db = getDb();
  const snap = await db.collection("products").get();
  let missing = 0;
  let batch = db.batch();
  let countInBatch = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as any;
    if (!data.siteId) {
      batch.set(
        doc.ref,
        { siteId: SITE_ID, updatedAt: Date.now() },
        { merge: true }
      );
      missing++;
      countInBatch++;
      if (countInBatch >= 400) {
        await batch.commit();
        batch = db.batch();
        countInBatch = 0;
      }
    }
  }
  if (countInBatch > 0) await batch.commit();
  console.log(`updated ${missing} docs with siteId=${SITE_ID}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
