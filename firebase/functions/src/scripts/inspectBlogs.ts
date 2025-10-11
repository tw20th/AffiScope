// firebase/functions/src/scripts/inspectBlogs.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const snap = await db
    .collection("blogs")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .get();

  console.log(`=== latest blogs (${snap.size}) ===`);
  for (const d of snap.docs) {
    const b = d.data() as any;
    console.log(
      [
        d.id,
        `site=${b.siteId}`,
        `status=${b.status}`,
        `title=${String(b.title || "").slice(0, 32)}`,
        `publishedAt=${b.publishedAt ?? "-"}`,
      ].join(" | ")
    );
  }
}

main().catch((e) => {
  console.error("[inspectBlogs] error:", e);
  process.exit(1);
});
