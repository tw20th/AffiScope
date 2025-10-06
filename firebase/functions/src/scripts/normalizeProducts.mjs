/**
 * refetchByAsins.mjs
 * ローカルで ASIN を再取得して Firestore に upsert（paapi.ts の修正を即反映）
 *
 * 使い方:
 *   node src/scripts/refetchByAsins.mjs chairscope B086JTCGZR,B0DK2ZR1TY
 */

import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ts-node を登録（このプロセス内のみ有効）
register("ts-node/esm", pathToFileURL("./"));

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function isValidAsin(s) {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}

async function main() {
  const siteId = (process.argv[2] || "").trim();
  const asinsArg = (process.argv[3] || "").trim();
  if (!siteId || !asinsArg) {
    console.error(
      "Usage: node src/scripts/refetchByAsins.mjs <siteId> <ASIN[,ASIN...]>"
    );
    process.exit(1);
  }
  const asins = Array.from(
    new Set(
      asinsArg
        .split(",")
        .map((s) => s.trim())
        .filter(isValidAsin)
    )
  );
  if (!asins.length) {
    console.error("No valid ASINs.");
    process.exit(1);
  }

  // サイト設定（PartnerTag 取得）
  const sdoc = await db.collection("sites").doc(siteId).get();
  if (!sdoc.exists) {
    console.error("site not found:", siteId);
    process.exit(1);
  }
  const site = { id: sdoc.id, ...(sdoc.data() || {}) };
  const partnerTag = site?.affiliate?.amazon?.partnerTag;

  // paapi.ts / mapAmazonToProduct.ts を TS のまま読み込む
  const { fetchAmazonOffers } = await import("../fetchers/amazon/paapi.ts");
  const { mapAmazonItemToProduct } = await import(
    "../lib/mapAmazonToProduct.ts"
  );

  // 取得
  const result = await fetchAmazonOffers(asins, { partnerTag });
  const now = Date.now();
  let upserts = 0;

  const batch = db.batch();
  for (const asin of asins) {
    const data = result[asin];
    if (!data) continue;

    // mapAmazonToProduct が期待する形に合わせる
    const ai = {
      ASIN: asin,
      Title: data.title,
      Brand: data.brand,
      ImageUrl: data.imageUrl,
      Price: data.price,
      DetailPageURL: data.url,

      // specs 素材
      Features: data.features,
      Dimensions: data.dimensions,
      Material: data.material,

      // 追加メタ
      WarrantyText: data.warranty,
      MerchantName: data.merchant,
      OfferCount: data.offerCount,
    };

    const prod = mapAmazonItemToProduct(ai, {
      siteId,
      categoryId: "gaming-chair",
    });

    const docId = `${siteId}_${asin}`;
    batch.set(db.collection("products").doc(docId), prod, { merge: true });
    upserts++;
  }

  if (upserts) await batch.commit();
  console.log(
    `refetchByAsins: upserts=${upserts} site=${siteId} asins=${asins.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
