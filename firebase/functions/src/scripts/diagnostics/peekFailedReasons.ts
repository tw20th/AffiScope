// Usage:
//   pnpm -C firebase/functions exec tsx src/scripts/peekFailedReasons.ts <siteId> [--mins=180]
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const [siteId, ...rest] = process.argv.slice(2).filter(Boolean);
  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/peekFailedReasons.ts <siteId> [--mins=180]"
    );
    process.exit(1);
  }
  const mins =
    Number((rest.find((a) => a.startsWith("--mins=")) || "").split("=")[1]) ||
    180;
  const since = Date.now() - mins * 60 * 1000;

  const snap = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .where("status", "==", "failed")
    .where("updatedAt", ">", since)
    .get();

  const map = new Map<string, number>();
  for (const d of snap.docs) {
    const e = String((d.data() as any).error || "");
    // 似た文言をまとめるために先頭100文字に丸める
    const key = e.slice(0, 100);
    map.set(key, (map.get(key) || 0) + 1);
  }
  const rows = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ count, reason }));
  console.table(rows);
  console.log({ scanned: snap.size, buckets: rows.length });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
