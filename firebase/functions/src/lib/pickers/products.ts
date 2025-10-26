// firebase/functions/src/lib/pickers/products.ts
import { Firestore } from "firebase-admin/firestore";

export async function pickRecentUpdated(siteId: string, db: Firestore) {
  const s = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("updatedAt", "desc")
    .limit(10)
    .get();
  return s.docs[0] ?? null;
}

export async function pickRecentCreated(siteId: string, db: Firestore) {
  const s = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  return s.docs[0] ?? null;
}
