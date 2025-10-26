/* eslint-disable no-console */
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { searchItems } from "../../services/rakuten/client.js";
import { mapRakutenToProduct } from "../../lib/products/mapRakutenToProduct.js";

const SITE_ID = process.argv[2] || "powerbank-scope";
const CATEGORY_ID = process.argv[3] || "powerbank";
const KEYWORD = process.argv[4] || "モバイルバッテリー";

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const { items } = await searchItems({
    keyword: KEYWORD,
    hits: 50,
    sort: "+itemPrice",
  });

  const batch = db.batch();
  const col = db.collection("products");

  for (const it of items) {
    const mapped = mapRakutenToProduct(it, {
      siteId: SITE_ID,
      categoryId: CATEGORY_ID,
    });
    const ref = col.doc(mapped.asin);
    batch.set(ref, mapped, { merge: true });
  }

  await batch.commit();
  console.log(
    `Upserted ${items.length} items for site=${SITE_ID}, category=${CATEGORY_ID}, keyword="${KEYWORD}"`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
