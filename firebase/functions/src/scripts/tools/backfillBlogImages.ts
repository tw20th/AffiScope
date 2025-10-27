// firebase/functions/src/scripts/tools/backfillBlogImages.ts
import "dotenv/config";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { findUnsplashHero } from "../../services/unsplash/client.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main(siteId = "kariraku", limit = 50) {
  console.log("[env] HAS_UNSPLASH_KEY =", !!process.env.UNSPLASH_ACCESS_KEY);

  const snap = await db
    .collection("blogs")
    .where("siteId", "==", siteId)
    .where("source", "==", "a8-offer")
    .where("imageUrl", "==", null)
    .limit(limit)
    .get();

  console.log("[scan]", { total: snap.size });
  let writes = 0;

  for (const doc of snap.docs) {
    const b = doc.data() as any;
    const q = [siteId, b.advertiser, b.title].filter(Boolean).join(" ");
    console.log("[try]", doc.id, "q=", q);

    const hero = await findUnsplashHero(
      q || "appliance rental home electronics"
    );
    if (!hero) {
      console.log("[skip] no hero returned");
      continue;
    }

    await doc.ref.update({
      imageUrl: hero.url,
      imageCredit: hero.credit ?? null,
      imageCreditLink: hero.creditLink ?? null,
      updatedAt: Date.now(),
    });
    writes++;
    console.log("[ok] updated", doc.id);
  }

  console.log("[done]", { scanned: snap.size, writes });
}

const site = process.argv[2] || "kariraku";
main(site).catch((e) => {
  console.error(e);
  process.exit(1);
});
