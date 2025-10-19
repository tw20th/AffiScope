// firebase/functions/src/scripts/resetAsinQueue.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { db } from "../lib/db.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const siteId = args.find((a) => !a.startsWith("--"));
  const mode = (
    args.find((a) => a.startsWith("--mode=")) || "--mode=requeue"
  ).split("=")[1];

  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/resetAsinQueue.ts <siteId> [--mode=requeue|delete]"
    );
    process.exit(1);
  }

  console.log(`[resetAsinQueue] siteId=${siteId} mode=${mode}`);

  const snap = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .get();

  console.log("[resetAsinQueue] found:", snap.size);

  let n = 0;
  const BATCH = 400;
  let batch = db.batch();
  const now = Date.now();

  for (const d of snap.docs) {
    const q = d.data() as any;
    // 触る対象: failed / invalid / processing / queued（とにかく一掃）
    if (mode === "delete") {
      batch.delete(d.ref);
    } else {
      batch.set(
        d.ref,
        {
          status: "queued",
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          priority: 0,
          updatedAt: now,
        },
        { merge: true }
      );
    }
    n++;
    if (n % BATCH === 0) {
      await batch.commit();
      batch = db.batch();
      await sleep(200);
    }
  }
  await batch.commit();

  // ついでにデッドレターも片付け（任意）
  const dead = await db
    .collection("asinDeadLetter")
    .where("siteId", "==", siteId)
    .get();
  if (dead.size) {
    let m = 0;
    let b2 = db.batch();
    for (const d of dead.docs) {
      if (mode === "delete") b2.delete(d.ref);
      else b2.delete(d.ref); // requeueの場合も削除して再挑戦させる
      m++;
      if (m % BATCH === 0) {
        await b2.commit();
        b2 = db.batch();
        await sleep(200);
      }
    }
    await b2.commit();
    console.log("[resetAsinQueue] deadletters removed:", dead.size);
  }

  console.log("[resetAsinQueue] done. affected:", n);
}

main().catch((e) => {
  console.error("[resetAsinQueue] error:", e);
  process.exit(1);
});
