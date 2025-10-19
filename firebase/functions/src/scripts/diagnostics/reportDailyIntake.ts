// firebase/functions/src/scripts/reportDailyIntake.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { parseArgs } from "node:util";

if (!getApps().length) initializeApp();
const db = getFirestore();

function parseSince(input?: string): number {
  if (!input) return Date.now() - 24 * 60 * 60 * 1000;
  if (/^\d+d$/.test(input)) {
    const d = Number(input.replace("d", ""));
    return Date.now() - d * 24 * 60 * 60 * 1000;
  }
  if (/^\d+h$/.test(input)) {
    const h = Number(input.replace("h", ""));
    return Date.now() - h * 60 * 60 * 1000;
  }
  const t = Date.parse(input);
  if (!Number.isFinite(t)) throw new Error(`Invalid --since: ${input}`);
  return t;
}

async function countByStatus(siteId: string, sinceMs: number) {
  const statuses = [
    "queued",
    "processing",
    "done",
    "failed",
    "invalid",
  ] as const;
  const out: Record<(typeof statuses)[number], number> = {
    queued: 0,
    processing: 0,
    done: 0,
    failed: 0,
    invalid: 0,
  };
  for (const s of statuses) {
    const snap = await db
      .collection("asinQueue")
      .where("siteId", "==", siteId)
      .where("status", "==", s)
      .where("updatedAt", ">=", sinceMs)
      .count()
      .get();
    out[s] = snap.data().count;
  }
  return out;
}

async function countProducts(siteId: string, sinceMs: number) {
  const created = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .where("createdAt", ">=", sinceMs)
    .count()
    .get();

  const updated = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .where("updatedAt", ">=", sinceMs)
    .count()
    .get();

  return { created: created.data().count, updated: updated.data().count };
}

(async () => {
  const { values } = parseArgs({ options: { since: { type: "string" } } });
  const sinceMs = parseSince(values.since as string | undefined);
  const sinceIso = new Date(sinceMs).toISOString();

  const sitesSnap = await db.collection("sites").get();
  console.log(`\n=== Daily Intake Report since ${sinceIso} ===\n`);

  let sumCreated = 0,
    sumUpdated = 0;
  let sumQueued = 0,
    sumProcessing = 0,
    sumDone = 0,
    sumFailed = 0,
    sumInvalid = 0;

  for (const s of sitesSnap.docs) {
    const siteId = s.id;
    const q = await countByStatus(siteId, sinceMs);
    const p = await countProducts(siteId, sinceMs);

    sumCreated += p.created;
    sumUpdated += p.updated;
    sumQueued += q.queued;
    sumProcessing += q.processing;
    sumDone += q.done;
    sumFailed += q.failed;
    sumInvalid += q.invalid;

    console.log(
      [
        `site: ${siteId}`,
        `products{ created:${p.created} updated:${p.updated} }`,
        `asinQueue{ done:${q.done} queued:${q.queued} processing:${q.processing} failed:${q.failed} invalid:${q.invalid} }`,
      ].join("  |  ")
    );
  }

  console.log(`\n--- TOTAL (since ${sinceIso}) ---`);
  console.log(
    [
      `products{ created:${sumCreated} updated:${sumUpdated} }`,
      `asinQueue{ done:${sumDone} queued:${sumQueued} processing:${sumProcessing} failed:${sumFailed} invalid:${sumInvalid} }`,
    ].join("  |  ")
  );
})();
