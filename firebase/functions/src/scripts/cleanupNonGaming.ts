import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const siteId = process.argv[2] || "chairscope";

  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .where("categoryId", "==", "gaming-chair")
    .get();

  const batch = db.batch();
  let deleted = 0;

  snap.forEach((doc) => {
    const title = String(doc.get("title") || "").toLowerCase();
    const isGaming = title.includes("ゲーミング") || title.includes("gaming");
    if (!isGaming) {
      batch.delete(doc.ref);
      deleted++;
    }
  });

  if (deleted > 0) await batch.commit();
  console.log(`cleanupNonGaming: deleted ${deleted} docs for site=${siteId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
