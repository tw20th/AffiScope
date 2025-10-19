// pnpm -C firebase/functions exec tsx src/scripts/unlockProcessing.ts <siteId> [--mins=15]
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
  const mins =
    Number((args.find((a) => a.startsWith("--mins=")) || "").split("=")[1]) ||
    15;
  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/unlockProcessing.ts <siteId> [--mins=15]"
    );
    process.exit(1);
  }
  const threshold = Date.now() - mins * 60 * 1000;

  // インデックスが無くても動くようフォールバック実装
  let docs = [];
  try {
    const snap = await db
      .collection("asinQueue")
      .where("siteId", "==", siteId)
      .where("status", "==", "processing")
      .get();
    docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  } catch {
    const all = await db.collection("asinQueue").get();
    docs = all.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(
        (d) => d.data.siteId === siteId && d.data.status === "processing"
      );
  }

  const stuck = docs.filter((d) => (d.data.updatedAt ?? 0) < threshold);
  const BATCH = 400;
  let done = 0;
  for (let i = 0; i < stuck.length; i += BATCH) {
    const batch = db.batch();
    for (const r of stuck.slice(i, i + BATCH)) {
      batch.update(db.collection("asinQueue").doc(r.id), {
        status: "queued",
        // attempts を上げすぎていると再取得対象外になる実装もあるためリセット
        attempts: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    done += Math.min(BATCH, stuck.length - i);
  }

  console.log(
    JSON.stringify(
      {
        siteId,
        mins,
        scanned: docs.length,
        unlocked: done,
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
