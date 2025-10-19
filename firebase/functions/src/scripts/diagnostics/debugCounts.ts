// pnpm -C firebase/functions exec tsx src/scripts/debugCounts.ts <siteId>
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function safeCount(
  coll: FirebaseFirestore.CollectionReference,
  siteId: string
) {
  try {
    // 単一コレクション + 等価条件（通常はインデックス不要）
    const snap = await coll.where("siteId", "==", siteId).get();
    return { docs: snap.docs };
  } catch (e: any) {
    // ここに来たらフォールバック：全件を取ってJSで絞る（数が多ければ重いが確実）
    console.warn(
      `[warn] index-free fallback for ${coll.path}:`,
      e?.code || e?.message || e
    );
    const all = await coll.get();
    const docs = all.docs.filter((d) => d.get("siteId") === siteId);
    return { docs };
  }
}

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("Usage: tsx src/scripts/debugCounts.ts <siteId>");
    process.exit(1);
  }

  // ルートコレクションを直接見る（collectionGroupは使わない）
  const asinColl = db.collection("asinQueue");
  const prodColl = db.collection("products");

  const { docs: asinDocs } = await safeCount(asinColl, siteId);
  const byStatus: Record<string, number> = {};
  for (const d of asinDocs) {
    const s = (d.get("status") as string) ?? "unknown";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  const { docs: prodDocs } = await safeCount(prodColl, siteId);
  let inStock = 0,
    withBest = 0;
  for (const d of prodDocs) {
    if (d.get("inStock") === true) inStock++;
    if (d.get("bestPrice")) withBest++;
  }

  console.log(
    JSON.stringify(
      {
        siteId,
        asinQueue: { total: asinDocs.length, byStatus },
        products: { total: prodDocs.length, inStock, withBestPrice: withBest },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
