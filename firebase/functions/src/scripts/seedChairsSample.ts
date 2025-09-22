// firebase/functions/src/scripts/seedChairsSample.ts
import { upsertProductSeed } from "../upsert/upsertProduct";

async function main() {
  const siteId = process.argv[2] || "chairscope";

  // ここに “テスト用の商品” をいくつか入れる
  // 実運用では updateByAsins.ts / seedFromAmazon.ts を使う想定ですが
  // まずは見える化のため最低限の手入力で。
  const samples = [
    {
      asin: "DUMMYCHAIR001", // 実ASINに置き換え可
      siteId,
      categoryId: "gaming-chair",
      title: "サンプル ゲーミングチェア 1",
      brand: "SampleBrand",
      imageUrl: "https://m.media-amazon.com/images/I/71wxxx.jpg", // 実画像URL推奨
      price: 17800,
      url: "https://www.amazon.co.jp/dp/DUMMYCHAIR001",
    },
    {
      asin: "DUMMYCHAIR002",
      siteId,
      categoryId: "gaming-chair",
      title: "サンプル ゲーミングチェア 2",
      brand: "SampleBrand",
      imageUrl: "https://m.media-amazon.com/images/I/61yxxx.jpg",
      price: 23800,
      url: "https://www.amazon.co.jp/dp/DUMMYCHAIR002",
    },
  ];

  for (const s of samples) {
    await upsertProductSeed(s);
  }
  console.log(`✔ seeded ${samples.length} products for ${siteId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
