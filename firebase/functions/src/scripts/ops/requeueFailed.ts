// 使い方: pnpm -C firebase/functions exec tsx src/scripts/requeueFailed.ts <siteId> [--max=200]
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const args = process.argv.slice(2);
  const siteId = args.find((a) => !a.startsWith("--"));
  const max =
    Number((args.find((a) => a.startsWith("--max=")) || "").split("=")[1]) ||
    200;
  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/requeueFailed.ts <siteId> [--max=200]"
    );
    process.exit(1);
  }
  // まず failed を新しい順で拾う（インデックス無い場合のフォールバック付き）
  let docs: any[] = [];
  try {
    const snap = await db
      .collection("asinQueue")
      .where("siteId", "==", siteId)
      .where("status", "==", "failed")
      .orderBy("updatedAt", "desc")
      .limit(max)
      .get();
    docs = snap.docs;
  } catch {
    const all = await db.collection("asinQueue").get();
    docs = all.docs
      .filter((d) => d.get("siteId") === siteId && d.get("status") === "failed")
      .sort((a, b) => (b.get("updatedAt") ?? 0) - (a.get("updatedAt") ?? 0))
      .slice(0, max);
  }

  const BATCH = 400;
  let cnt = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + BATCH)) {
      batch.update(d.ref, {
        status: "queued",
        attempts: 0,
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      cnt++;
    }
    await batch.commit();
  }
  console.log(JSON.stringify({ siteId, requeued: cnt }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
