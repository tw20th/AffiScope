// pnpm -C firebase/functions exec tsx src/scripts/peekQueue.ts <siteId>
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("Usage: tsx src/scripts/peekQueue.ts <siteId>");
    process.exit(1);
  }

  const coll = db.collection("asinQueue");
  let rows: any[] = [];
  try {
    // updatedAt 降順（インデックス不要のはずだが、もし失敗したらフォールバック）
    const snap = await coll
      .where("siteId", "==", siteId)
      .orderBy("updatedAt", "desc")
      .limit(20)
      .get();
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e: any) {
    console.warn("[warn] orderBy fallback:", e?.code || e?.message || e);
    const all = await coll
      .where("siteId", "==", siteId)
      .get()
      .catch(async () => {
        // さらに失敗したら全件→JSで絞る
        const all2 = await coll.get();
        return {
          docs: all2.docs.filter((d) => d.get("siteId") === siteId),
        } as any;
      });
    rows = all.docs
      .map((d: any) => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 20);
  }

  const table = rows.map((r) => ({
    id: r.id,
    asin: r.asin,
    status: r.status,
    attempts: r.attempts,
    priority: r.priority,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));
  console.table(table);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
