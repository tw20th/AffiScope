// firebase/functions/src/scripts/retryDeadLetter.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

export async function requeueDeadLetters(limit = 200) {
  const now = Date.now();
  const snap = await db.collection("asinDeadLetter").limit(limit).get();

  const batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    const { siteId, asin } = d.data() as any;
    if (!siteId || !asin) continue;
    batch.set(
      db.collection("asinQueue").doc(`${siteId}_${asin}`),
      {
        siteId,
        asin,
        status: "queued",
        attempts: 0,
        priority: 5,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    batch.delete(d.ref);
    n++;
  }
  if (n) await batch.commit();
  return n;
}
