// firebase/functions/src/scripts/seedChairsCategories.ts
import * as admin from "firebase-admin";

function db() {
  if (admin.apps.length === 0) admin.initializeApp();
  return admin.firestore();
}

/**
 * ゲーミングチェア用のカテゴリを chairscope に投入。
 * 必要に応じて名称/順序を調整してください。
 */
async function main() {
  const siteId = process.argv[2] || "chairscope";
  const categories = [
    { id: "gaming-chair", name: "ゲーミングチェア", parentId: null, order: 1 },

    // 下層例（お好みで増減OK）
    { id: "ergonomic", name: "人間工学", parentId: "gaming-chair", order: 10 },
    { id: "racing", name: "レーシング", parentId: "gaming-chair", order: 20 },
    { id: "budget", name: "1万円台", parentId: "gaming-chair", order: 30 },
    { id: "premium", name: "高価格帯", parentId: "gaming-chair", order: 40 },
    {
      id: "big-and-tall",
      name: "大型・高耐荷重",
      parentId: "gaming-chair",
      order: 50,
    },
  ];

  const now = Date.now();
  const batch = db().batch();
  for (const cat of categories) {
    const ref = db().collection("categories").doc(cat.id);
    batch.set(
      ref,
      {
        siteId,
        id: cat.id,
        name: cat.name,
        parentId: cat.parentId,
        order: cat.order,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }
  await batch.commit();
  console.log(`✔ seeded categories for ${siteId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
