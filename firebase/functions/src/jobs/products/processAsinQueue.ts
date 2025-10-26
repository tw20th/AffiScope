import * as functions from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { retagBySiteRules } from "../../lib/products/tagging.js";
import { buildAiSummary } from "../../lib/content/summary.js";
import { getSiteConfig } from "../../lib/sites/siteConfig.js";
import { normalizeProductFromOffer } from "../../lib/products/normalize.js";
import { computeFreshFor, pickPolicy } from "../../lib/products/staleness.js";
import { getPaapiOptionsFromSite } from "../../lib/vendors/paapi/paapiOpts.js";
import { getItemsOnce } from "../../services/paapi/client.js";

function isFromCloudTasks(req: any): boolean {
  // Cloud Tasks (HTTP target) が付けるヘッダ
  return Boolean(
    req.header("x-cloudtasks-queuename") || req.header("x-cloudtasks-taskname")
  );
}

type QueueDoc = {
  siteId: string;
  asin: string;
  status: "queued" | "processing" | "done" | "failed";
  priority?: number;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number; // クールダウンで未来時刻が入る
  error?: string | FirebaseFirestore.FieldValue;
};

const REGION = "asia-northeast1";
const TZ = "Asia/Tokyo";
const FOCUS_SITE_ID = process.env.FOCUS_SITE_ID || "";

// ── 安全側の既定（env で上書き可）
const BATCH_SIZE = +(process.env.QUEUE_BATCH_SIZE || 1);
const MAX_ATTEMPTS = +(process.env.QUEUE_MAX_ATTEMPTS || 3);
const FETCH_CHUNK_SIZE = +(process.env.PAAPI_CHUNK_SIZE || 1);
const FETCH_INTERVAL_MS = +(process.env.PAAPI_INTERVAL_MS || 20000);
const FETCH_RETRIES = +(process.env.PAAPI_RETRIES || 3);
const FETCH_JITTER = +(process.env.PAAPI_JITTER || 0.5);
const COOLDOWN_MS = +(process.env.PAAPI_COOLDOWN_MS || 30 * 60_000); // 429 個別CD(デフォ30分)

// ── 単一実行ロック
const LOCK_DOC_PATH = "locks/processAsinQueue";

// ── グローバル・クールダウン（429の連鎖時に一時停止）
const GLOBAL_COOLDOWN_DOC = "meta/paapiCooldown";
const GLOBAL_COOLDOWN_MIN_MS = 30 * 60_000; // 最低30分は全体で休む

const now = () => Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryAcquireLock(
  db: FirebaseFirestore.Firestore,
  ttlMs = 5 * 60_000
): Promise<boolean> {
  const ref = db.doc(LOCK_DOC_PATH);
  const nowTs = now();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const v = snap.exists ? (snap.data() as any) : null;
      if (v && Number(v.expiresAt || 0) > nowTs) throw new Error("locked");
      tx.set(ref, {
        holder: "functions",
        expiresAt: nowTs + ttlMs,
        updatedAt: nowTs,
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(db: FirebaseFirestore.Firestore) {
  try {
    await db.doc(LOCK_DOC_PATH).delete();
  } catch {}
}

// ── グローバル・クールダウン
async function getGlobalCooldown(
  db: FirebaseFirestore.Firestore
): Promise<number> {
  try {
    const snap = await db.doc(GLOBAL_COOLDOWN_DOC).get();
    const until = Number((snap.data() as any)?.until || 0);
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

async function setGlobalCooldown(
  db: FirebaseFirestore.Firestore,
  ms: number
): Promise<void> {
  try {
    const until = Date.now() + ms;
    await db
      .doc(GLOBAL_COOLDOWN_DOC)
      .set({ until, updatedAt: Date.now() }, { merge: true });
  } catch {}
}

// ── ユーティリティ
function isTooMany(e: unknown): boolean {
  const s = String((e as any)?.message || (e as any)?.toString?.() || e);
  return (
    /Too\s*Many\s*Requests/i.test(s) ||
    /429/.test(s) ||
    /RATE_TPD_EXHAUSTED/.test(s)
  );
}

function buildAffiliateUrl(asin: string, partnerTag?: string) {
  const tag = partnerTag || process.env.AMAZON_PARTNER_TAG || "";
  const base = `https://www.amazon.co.jp/dp/${asin}`;
  return tag ? `${base}?tag=${tag}&linkCode=ogi&th=1&psc=1` : base;
}

// ── pick（FOCUS + 個別CD + グローバルCD）
async function pickQueueDocs(db: FirebaseFirestore.Firestore) {
  const ts = now();

  // グローバル・クールダウン中はスキップ
  const gUntil = await getGlobalCooldown(db);
  if (gUntil > ts) {
    console.log(`[queue] global cooldown until ${gUntil} (skip pick)`);
    return [] as FirebaseFirestore.QueryDocumentSnapshot<QueueDoc>[];
  }

  let q = db
    .collection("asinQueue")
    .where("status", "==", "queued")
    .where("updatedAt", "<=", ts) // 個別クールダウン解除済のみ
    .orderBy("updatedAt", "asc") // 範囲フィールドは最初
    .orderBy("priority", "asc")
    .orderBy("attempts", "asc")
    .orderBy("siteId", "asc")
    .limit(BATCH_SIZE) as FirebaseFirestore.Query;

  if (FOCUS_SITE_ID) {
    q = q.where("siteId", "==", FOCUS_SITE_ID);
  }

  const snap = await q.get();
  return snap.docs as FirebaseFirestore.QueryDocumentSnapshot<QueueDoc>[];
}

async function lockDocs(
  db: FirebaseFirestore.Firestore,
  docs: FirebaseFirestore.QueryDocumentSnapshot<QueueDoc>[]
) {
  const locked: Array<{
    ref: FirebaseFirestore.DocumentReference<QueueDoc>;
    data: QueueDoc;
  }> = [];
  await db.runTransaction(async (tx) => {
    for (const d of docs) {
      const ref = d.ref as FirebaseFirestore.DocumentReference<QueueDoc>;
      const data = d.data();
      if (data.status !== "queued") continue;
      tx.update(ref, {
        status: "processing",
        attempts: (data.attempts || 0) + 1,
        updatedAt: now(),
      } as Partial<QueueDoc>);
      locked.push({ ref, data: { ...data, status: "processing" } });
    }
  });
  return locked;
}

// ── PA-API チャンク取得（429時は指数バックオフ＋後続チャンクも間引き）
async function fetchOffersChunked(
  asins: string[],
  siteCfg: ReturnType<typeof getPaapiOptionsFromSite>
): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (let i = 0; i < asins.length; i += FETCH_CHUNK_SIZE) {
    const chunk = asins.slice(i, i + FETCH_CHUNK_SIZE);
    let attempt = 0;
    for (;;) {
      try {
        const r = await getItemsOnce(chunk, siteCfg);
        Object.assign(out, r);
        break;
      } catch (e) {
        if (attempt < FETCH_RETRIES && isTooMany(e)) {
          const base = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s...
          const wait = Math.ceil(
            base * (1 + (Math.random() * 2 - 1) * FETCH_JITTER)
          );
          console.warn(
            `[paapi] throttled. retry in ${wait}ms (attempt=${
              attempt + 1
            }/${FETCH_RETRIES})`
          );
          await sleep(wait);
          attempt++;
          continue;
        }
        throw e;
      }
    }

    if (i + FETCH_CHUNK_SIZE < asins.length) {
      const wait = Math.ceil(
        FETCH_INTERVAL_MS * (1 + (Math.random() * 2 - 1) * FETCH_JITTER)
      );
      await sleep(wait);
    }
  }
  return out;
}

// ── メイン
export async function processOnce(): Promise<{
  taken: number;
  done: number;
  failed: number;
}> {
  const db = getFirestore();

  // 単一実行ロック
  const got = await tryAcquireLock(db);
  if (!got) {
    console.log("[queue] skip: locked");
    return { taken: 0, done: 0, failed: 0 };
  }

  try {
    const picked = await pickQueueDocs(db);
    if (picked.length === 0) return { taken: 0, done: 0, failed: 0 };

    const locked = await lockDocs(db, picked);
    if (locked.length === 0) return { taken: 0, done: 0, failed: 0 };

    type Group = { asins: string[]; items: typeof locked };
    const grouped = new Map<string, Group>();
    for (const it of locked) {
      const key = it.data.siteId;
      if (!grouped.has(key))
        grouped.set(key, { asins: [], items: [] as typeof locked });
      const g = grouped.get(key)!;
      g.asins.push(it.data.asin);
      g.items.push(it);
    }

    let ok = 0,
      ng = 0;

    for (const [siteId, group] of grouped) {
      const site = await getSiteConfig(siteId);
      if (!site) {
        await Promise.all(
          group.items.map(({ ref }) =>
            ref.update({
              status: "failed",
              updatedAt: now(),
              error: "site config not found",
            } as Partial<QueueDoc>)
          )
        );
        ng += group.items.length;
        continue;
      }

      const paapiOpts = getPaapiOptionsFromSite(site);

      let offers: Record<string, any> = {};
      try {
        offers = await fetchOffersChunked(group.asins, paapiOpts);
      } catch (e: any) {
        const tooMany = isTooMany(e);
        console.error(`[site:${siteId}] getItemsOnce ERROR:`, e?.message || e);

        // ── 429 等の時は：個別CD＋グローバルCDを設定
        await Promise.all(
          group.items.map(async ({ ref, data: q }) => {
            const patch: Partial<QueueDoc> = {
              status: tooMany ? "queued" : "failed",
              updatedAt: tooMany ? now() + COOLDOWN_MS : now(),
              error: `getItemsOnce failed: ${e?.message || String(e)}`,
            };
            if (tooMany) patch.attempts = Math.max(0, (q.attempts || 1) - 1);
            await ref.update(patch as any);
          })
        );

        if (tooMany) {
          // 全体も休ませる（個別CDより短くても最低30分は休む）
          const gMs = Math.max(COOLDOWN_MS, GLOBAL_COOLDOWN_MIN_MS);
          await setGlobalCooldown(db, gMs);
          console.log(`[queue] set global cooldown ${gMs}ms`);
        } else {
          ng += group.items.length;
        }
        continue;
      }

      const batch = db.batch();
      let siteOk = 0,
        siteNg = 0;

      for (const { ref, data: q } of group.items) {
        try {
          const offer = offers[q.asin] || null;

          const affiliateTag = paapiOpts.partnerTag;
          const baseDoc: any = {
            siteId,
            asin: q.asin,
            slug: `${siteId}_${q.asin}`,
            affiliateUrl: buildAffiliateUrl(q.asin, affiliateTag),
            lastSeenAt: now(),
            updatedAt: now(),
          };
          if (offer)
            Object.assign(baseDoc, normalizeProductFromOffer(q.asin, offer));

          const tags = await retagBySiteRules(siteId, baseDoc);
          if (tags?.length) baseDoc.tags = tags;

          baseDoc.aiSummary = buildAiSummary({
            title: baseDoc.title,
            tags: baseDoc.tags || [],
            price: baseDoc.bestPrice?.price ?? baseDoc.price ?? undefined,
          });

          const views = Number(baseDoc.views || 0);
          const pinned = !!baseDoc.pinned;
          const policy = pickPolicy(views, pinned);
          baseDoc.freshUntil = computeFreshFor(policy, Date.now());

          const prodRef = db.collection("products").doc(`${siteId}_${q.asin}`);
          batch.set(prodRef, baseDoc, { merge: true });

          batch.update(ref, {
            status: "done",
            updatedAt: now(),
            error: FieldValue.delete(),
          } as Partial<QueueDoc>);

          ok++;
          siteOk++;
        } catch (e: any) {
          const attempts = q.attempts || 1;
          const toStatus: QueueDoc["status"] =
            attempts >= MAX_ATTEMPTS ? "failed" : "queued";
          batch.update(ref, {
            status: toStatus,
            updatedAt: now(),
            error: e?.message || String(e),
          } as Partial<QueueDoc>);
          ng++;
          siteNg++;
        }
      }

      await batch.commit();
      console.log(
        `[queue][${siteId}] done=${siteOk} ng=${siteNg} taken=${group.items.length}`
      );
    }

    return { taken: locked.length, done: ok, failed: ng };
  } finally {
    await releaseLock(getFirestore());
  }
}

// ── スケジュール＆HTTP
const RUNTIME: functions.RuntimeOptions = {
  timeoutSeconds: 540,
  memory: "512MB",
  maxInstances: 1,
};

export const scheduledProcessAsinQueue = functions
  .region(REGION)
  .runWith(RUNTIME)
  .pubsub.schedule("every 30 minutes") // ← 15分 → 30分（さらに保守）
  .timeZone(TZ)
  .onRun(async () => {
    const r = await processOnce();
    console.log("[queue] result:", r);
  });

/**
 * 手動連打によるスパイクを防ぐため、デフォルトは 403 を返す。
 * 一時的に手動実行したい時だけ .env で ALLOW_MANUAL_QUEUE_RUN=true を設定。
 */
export const runProcessAsinQueue = functions
  .region(REGION)
  .runWith(RUNTIME)
  .https.onRequest(async (req, res) => {
    // ① Cloud Tasks からなら許可（安全運用：Tasks キューからしか来ない前提）
    if (isFromCloudTasks(req)) {
      try {
        const r = await processOnce();
        return void res.status(200).json(r);
      } catch (e: any) {
        return void res.status(500).json({ error: e?.message || String(e) });
      }
    }

    // ② それ以外（手動直叩き）は従来通り safe mode で拒否
    const allow = String(
      process.env.ALLOW_MANUAL_QUEUE_RUN || ""
    ).toLowerCase();
    if (!(allow === "1" || allow === "true" || allow === "yes")) {
      return void res.status(403).json({
        ok: false,
        error: "manual queue run is disabled in safe mode",
      });
    }

    try {
      const r = await processOnce();
      res.status(200).json(r);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
