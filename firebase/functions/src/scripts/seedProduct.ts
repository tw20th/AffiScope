// firebase/functions/src/scripts/seedProduct.ts（差分）
import "dotenv/config";
import { getDb } from "./_firestoreClient";
import { computeBestPrice } from "../utils/price";

async function main() {
  const db = getDb();
  const now = Date.now();
  const offers = [
    {
      source: "amazon" as const,
      price: 2980,
      url: "https://example.com/a",
      lastSeenAt: now,
    },
  ];

  const p = {
    asin: "DUMMYASIN001",
    title: "サンプル モバイルバッテリー 10000mAh",
    brand: "AffiBrand",
    imageUrl: "https://via.placeholder.com/400x300?text=Battery",
    categoryId: "mobile-battery",
    siteId: "affiscope", // ★追加
    offers,
    priceHistory: [{ ts: now, source: "amazon" as const, price: 2980 }],
    bestPrice: computeBestPrice({ offers }),
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("products").doc(p.asin).set(p, { merge: true });
  console.log("✅ product seed done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
