// firebase/functions/src/scripts/checkMissingProducts.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main(siteId: string) {
  const q = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .where("status", "==", "done")
    .limit(500)
    .get();

  const missing: string[] = [];
  for (const d of q.docs) {
    const asin = d.get("asin") as string;
    const id = `${siteId}_${asin}`;
    const pref = db.collection("products").doc(id);
    const psnap = await pref.get();
    if (!psnap.exists) missing.push(id);
  }
  console.log("done=", q.size, "missing products=", missing.length);
  if (missing.length) {
    console.log(missing.slice(0, 50).join("\n"));
  }
}

const siteId = process.argv[2] || "chairscope";
main(siteId)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
