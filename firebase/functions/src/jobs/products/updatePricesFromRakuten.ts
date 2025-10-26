/* eslint-disable no-console */
import { getFirestore } from "firebase-admin/firestore";
import { searchItems } from "../../services/rakuten/client.js";
import { mapRakutenToProduct } from "../../lib/products/mapRakutenToProduct.js";

export async function updatePricesFromRakuten(
  siteId: string,
  categoryId: string,
  keyword: string
) {
  const db = getFirestore();
  const { items } = await searchItems({
    keyword,
    hits: 50,
    sort: "+itemPrice",
  });

  const batch = db.batch();
  for (const it of items) {
    const mapped = mapRakutenToProduct(it, { siteId, categoryId });
    const ref = db.collection("products").doc(mapped.asin);
    batch.set(
      ref,
      {
        // 価格系だけマージ（空で上書きしない）
        bestPrice: mapped.bestPrice,
        affiliateUrl: mapped.affiliateUrl,
        updatedAt: mapped.updatedAt,
        reviewAverage: mapped.reviewAverage,
        reviewCount: mapped.reviewCount,
      },
      { merge: true }
    );
  }
  await batch.commit();
}
