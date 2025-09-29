// firebase/functions/src/scripts/countProductsBySite.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const siteId = process.argv[2] || "chairscope";

const snap = await db
  .collection("products")
  .where("siteId", "==", siteId)
  .get();
console.log("siteId=", siteId, "products=", snap.size);
const first = snap.docs
  .slice(0, 5)
  .map((d) => ({
    id: d.id,
    title: d.get("title"),
    bestPrice: d.get("bestPrice"),
  }));
console.log(first);
process.exit(0);
