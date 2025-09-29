import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { summaryFromContent } from "../utils/summary.js";

initializeApp();
const db = getFirestore();

(async () => {
  const snap = await db.collection("blogs").get();
  const batch = db.batch();
  let count = 0;

  snap.forEach((doc) => {
    const d = doc.data();
    const cur = (d.summary ?? "").trim();
    const content = (d.content ?? "").trim();
    if (!cur && content) {
      batch.update(doc.ref, {
        summary: summaryFromContent(content),
        updatedAt: Date.now(),
      });
      count++;
    }
  });

  if (count > 0) await batch.commit();
  console.log(`updated ${count} blog(s).`);
})();
