// firebase/functions/src/scripts/fetchAmazon.ts
import "dotenv/config";
import admin from "firebase-admin";
import { fetchAmazonOffers } from "../fetchers/amazon/paapi.js";
import {
  pruneUndefinedDeep,
  buildAffiliateUrl,
  buildSlug,
  inferAvailability,
  makeAiSummary,
} from "../lib/ingestHelpers.js";
import { retagBySiteRules } from "../lib/tagging.js";

const app = admin.apps.length ? admin.app() : admin.initializeApp();
const db = admin.firestore();

async function main() {
  const siteId = process.argv[2]; // 例: chairscope
  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/fetchAmazon.ts <siteId> [asin1,asin2,...]"
    );
    process.exit(1);
  }

  // 入力: seeds or 引数の ASIN 群
  const asinsArg = process.argv[3];
  let asins: string[] = [];
  if (asinsArg) {
    asins = asinsArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    // サイト設定から seeds を読む実装に合わせて取得してください
    const siteCfgSnap = await db.collection("sites").doc(siteId).get();
    const seeds = siteCfgSnap.get("seeds.asins") as string[] | undefined;
    asins = (seeds || []).slice(0, 10);
  }

  if (!asins.length) {
    console.log("[fetchAmazon] no ASINs.");
    return;
  }

  const partnerTag =
    process.env.AMAZON_PARTNER_TAG ||
    (await db.collection("sites").doc(siteId).get()).get(
      "affiliate.amazon.partnerTag"
    );
  const now = Date.now();

  const offers = await fetchAmazonOffers(asins, { partnerTag });

  const batch = db.batch();
  let updates = 0;

  for (const asin of asins) {
    const o = offers[asin];
    if (!o) continue;

    const affiliateUrl = buildAffiliateUrl(asin, partnerTag);
    const slug = buildSlug(siteId, asin);
    const { availability, inStock } = inferAvailability(o.price);

    const bestPrice =
      typeof o.price === "number" ? { price: Math.round(o.price) } : undefined;

    const specs = pruneUndefinedDeep({
      material: o.material || "",
      features: o.features || [],
      dimensions: o.dimensions, // prune が undefined を落とします
    });

    const priceHistoryEntry = bestPrice?.price
      ? [{ price: bestPrice.price, source: "amazon", ts: now }]
      : [];

    const offersArr = [
      {
        source: "amazon" as const,
        url: o.url || affiliateUrl,
        price: bestPrice?.price,
        lastSeenAt: now,
      },
    ];

    // 一旦基本フィールドでタグ & サマリ
    const pseudoProduct = { title: o.title, specs, bestPrice };
    const tags = await retagBySiteRules(siteId, pseudoProduct);
    const aiSummary = makeAiSummary(o.title, bestPrice?.price, tags);

    const docRef = db.collection("products").doc(`${siteId}_${asin}`);
    const update = pruneUndefinedDeep({
      siteId,
      asin,
      slug,
      url: o.url || affiliateUrl,
      affiliateUrl,
      title: o.title,
      categoryId: "gaming-chair", // 既定カテゴリ。site の productRules から自動判定するなら差し替え可
      bestPrice,
      priceHistory: priceHistoryEntry.length
        ? admin.firestore.FieldValue.arrayUnion(...priceHistoryEntry)
        : undefined,
      offers: admin.firestore.FieldValue.arrayUnion(...offersArr),
      availability,
      inStock,
      lastSeenAt: now,
      updatedAt: now,
      specs,
      tags,
      aiSummary,
      source: "amazon",
    });

    batch.set(docRef, update, { merge: true });
    updates++;
  }

  await batch.commit();
  console.log(`[fetchAmazon] site=${siteId} updates=${updates}`);
}

main().catch((e) => {
  console.error("[fetchAmazon] fatal:", e);
  process.exit(1);
});
