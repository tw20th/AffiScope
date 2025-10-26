// firebase/functions/src/jobs/queueHousekeeping.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const GLOBAL_COOLDOWN_DOC = "meta/paapiCooldown";
const FOCUS_SITE_ID = process.env.FOCUS_SITE_ID || "";

const DEFAULT_PROCESSING_MAX_AGE_MIN = 15;
const DEFAULT_MAX_ATTEMPTS = +(process.env.QUEUE_MAX_ATTEMPTS || 3);
const DEFAULT_SLEEP_OTHERS_DAYS = 14;

const now = () => Date.now();

async function releaseStuckProcessings(
  db: FirebaseFirestore.Firestore,
  maxAgeMin: number,
  siteId?: string
) {
  const cutoff = now() - maxAgeMin * 60_000;
  let q = db
    .collection("asinQueue")
    .where("status", "==", "processing")
    .where("updatedAt", "<=", cutoff) as FirebaseFirestore.Query;

  if (siteId) q = q.where("siteId", "==", siteId);

  const snap = await q.get();
  let cnt = 0;
  const batch = db.batch();
  snap.forEach((d) => {
    const data = d.data() as any;
    const attempts = Math.max(0, Number(data?.attempts || 0) - 1);
    batch.update(d.ref, { status: "queued", attempts, updatedAt: now() });
    cnt++;
  });
  if (cnt) await batch.commit();
  return cnt;
}

async function failExceededAttempts(
  db: FirebaseFirestore.Firestore,
  maxAttempts: number,
  siteId?: string
) {
  let q = db
    .collection("asinQueue")
    .where("status", "in", ["queued", "processing"]) as FirebaseFirestore.Query;

  if (siteId) q = q.where("siteId", "==", siteId);

  const snap = await q.get();
  let cnt = 0;
  const batch = db.batch();
  snap.forEach((d) => {
    const at = Number((d.data() as any)?.attempts || 0);
    if (at >= maxAttempts) {
      batch.update(d.ref, {
        status: "failed",
        updatedAt: now(),
        error: `housekeeping: attempts>=${maxAttempts}`,
      });
      cnt++;
    }
  });
  if (cnt) await batch.commit();
  return cnt;
}

async function sleepNonFocusSites(
  db: FirebaseFirestore.Firestore,
  focusSiteId: string,
  days: number
) {
  if (!focusSiteId) return 0;
  const future = now() + days * 24 * 60 * 60 * 1000;

  const snap = await db
    .collection("asinQueue")
    .where("status", "==", "queued")
    .where("siteId", "!=", focusSiteId)
    .get();

  let cnt = 0;
  const batch = db.batch();
  snap.forEach((d) => {
    batch.update(d.ref, { updatedAt: future });
    cnt++;
  });
  if (cnt) await batch.commit();
  return cnt;
}

async function clearGlobalCooldown(db: FirebaseFirestore.Firestore) {
  await db
    .doc(GLOBAL_COOLDOWN_DOC)
    .set({ until: 0, updatedAt: now() }, { merge: true });
}

/** ← スクリプトから直接呼ぶ用の素関数（Promise で結果を返す） */
export async function runQueueHousekeepingOnce(opts?: {
  siteId?: string;
  processingMaxAgeMins?: number;
  maxAttempts?: number;
  sleepOthersDays?: number;
  clearGlobalCooldown?: boolean;
}) {
  const db = getFirestore();
  const siteIdQuery = (opts?.siteId || "").trim();
  const focusForThisRun = siteIdQuery || FOCUS_SITE_ID || "";
  const maxAgeMin =
    opts?.processingMaxAgeMins ?? DEFAULT_PROCESSING_MAX_AGE_MIN;
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleepDays = opts?.sleepOthersDays ?? DEFAULT_SLEEP_OTHERS_DAYS;
  const clearGC = !!opts?.clearGlobalCooldown;

  const released = await releaseStuckProcessings(
    db,
    maxAgeMin,
    focusForThisRun || undefined
  );
  const failed = await failExceededAttempts(
    db,
    maxAttempts,
    focusForThisRun || undefined
  );

  let slept = 0;
  if (sleepDays > 0 && FOCUS_SITE_ID && !siteIdQuery) {
    slept = await sleepNonFocusSites(db, FOCUS_SITE_ID, sleepDays);
  }
  if (clearGC) await clearGlobalCooldown(db);

  return {
    ok: true,
    focusSiteId: focusForThisRun || null,
    actions: {
      releasedStuckProcessings: released,
      failedExceededAttempts: failed,
      sleptNonFocusQueued: slept,
      clearedGlobalCooldown: clearGC,
    },
    params: {
      processingMaxAgeMins: maxAgeMin,
      maxAttempts,
      sleepOthersDays: sleepDays,
    },
  };
}

/** Cloud Functions ハンドラ（HTTP）：内部で runQueueHousekeepingOnce を呼ぶ */
export const runQueueHousekeeping = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const result = await runQueueHousekeepingOnce({
        siteId: String(req.query.siteId || ""),
        processingMaxAgeMins:
          Number(req.query.processingMaxAgeMins) || undefined,
        maxAttempts: Number(req.query.maxAttempts) || undefined,
        sleepOthersDays: Number(req.query.sleepOthersDays) || undefined,
        clearGlobalCooldown:
          String(req.query.clearGlobalCooldown || "") === "1",
      });
      res.json(result);
    } catch (e: any) {
      console.error("[runQueueHousekeeping] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

/** グローバルCDの確認/更新（そのまま） */
export const globalCooldown = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const db = getFirestore();
    try {
      if (req.method === "POST") {
        const until = typeof req.body?.until === "number" ? req.body.until : 0;
        await db
          .doc(GLOBAL_COOLDOWN_DOC)
          .set({ until, updatedAt: now() }, { merge: true });
        res.json({ ok: true, until });
        return;
      }
      const snap = await db.doc(GLOBAL_COOLDOWN_DOC).get();
      const v = snap.exists ? (snap.data() as any) : {};
      res.json({ ok: true, until: Number(v?.until || 0) });
      return;
    } catch (e: any) {
      console.error("[globalCooldown] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
