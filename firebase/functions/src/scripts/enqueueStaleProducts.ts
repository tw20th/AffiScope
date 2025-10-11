// firebase/functions/src/scripts/enqueueStaleProducts.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { isStale, pickPolicy, computeFreshFor } from "../lib/staleness.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const MAX_ATTEMPTS = 5;

function isValidAsin(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}
function qid(siteId: string, asin: string) {
  return `${siteId}_${asin}`;
}

/** asinQueue に ASIN を投入（statusやcooldownを考慮） */
async function enqueueAsins(
  siteId: string,
  asins: string[],
  opts?: { cooldownDays?: number; forceCooldown?: boolean; priority?: number }
): Promise<number> {
  const now = Date.now();
  const cooldownMs = (opts?.cooldownDays || 0) * 24 * 60 * 60 * 1000;

  const valid = Array.from(new Set(asins.filter(isValidAsin)));
  if (!valid.length) return 0;

  // 既存のキュー状態だけを見る（既存productsでも再取得したいので除外しない）
  const snaps = await Promise.all(
    valid.map((a) => db.collection("asinQueue").doc(qid(siteId, a)).get())
  );

  const enqueueList: string[] = [];
  snaps.forEach((s, i) => {
    const asin = valid[i];
    if (!s.exists) {
      enqueueList.push(asin);
      return;
    }
    const q = s.data() as any;
    const busy = q?.status === "queued" || q?.status === "processing";
    const recent =
      typeof q?.updatedAt === "number" && now - q.updatedAt < cooldownMs;
    const reached =
      (q?.attempts ?? 0) >= MAX_ATTEMPTS || q?.status === "failed";

    if (opts?.forceCooldown) {
      if (!busy && !reached) enqueueList.push(asin);
      return;
    }
    if (!busy && !recent && !reached) enqueueList.push(asin);
  });

  if (!enqueueList.length) return 0;

  const batch = db.batch();
  enqueueList.forEach((asin) => {
    batch.set(
      db.collection("asinQueue").doc(qid(siteId, asin)),
      {
        siteId,
        asin,
        status: "queued",
        attempts: 0,
        priority: opts?.priority ?? 0,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
  await batch.commit();
  return enqueueList.length;
}

/**
 * ★ エクスポート関数：サイト内の stale な商品を再投入する
 * - 優先的に freshUntil を見て期限切れだけを拾う
 * - freshUntil が無い旧データは lastSeenAt の古い順に拾う
 * - 次回 freshUntil も views/pinned に応じて再計算して押し直す
 */
export async function enqueueStaleBySite(
  siteId: string,
  limit = 500
): Promise<number> {
  const now = Date.now();

  // 1) freshUntil ベースで古い順に取得
  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("freshUntil", "asc")
    .orderBy("updatedAt", "asc")
    .limit(Math.max(1, limit))
    .get();

  const targetAsins: string[] = [];
  const batch = db.batch();

  snap.forEach((d) => {
    const asin = d.get("asin") as string | undefined;
    if (!asin) return;

    const freshUntil = d.get("freshUntil") as number | undefined;
    const views = Number(d.get("views") || 0);
    const pinned = !!d.get("pinned");

    // freshUntil が無い古いデータや、期限切れだけ対象
    if (isStale(freshUntil, now)) {
      targetAsins.push(asin);

      // 次回の鮮度を上書きしておく（露出ベース）
      const policy = pickPolicy(views, pinned);
      const nextFresh = computeFreshFor(policy, now);
      batch.update(d.ref, { freshUntil: nextFresh });
    }
  });

  // 2) freshUntil で拾えなかった & still 足りない場合、lastSeenAt フォールバック
  if (targetAsins.length < limit) {
    const remain = limit - targetAsins.length;
    const fb = await db
      .collection("products")
      .where("siteId", "==", siteId)
      .orderBy("lastSeenAt", "asc")
      .limit(remain)
      .get();

    fb.forEach((d) => {
      const asin = d.get("asin") as string | undefined;
      if (!asin) return;
      if (!targetAsins.includes(asin)) {
        targetAsins.push(asin);

        const views = Number(d.get("views") || 0);
        const pinned = !!d.get("pinned");
        const nextFresh = computeFreshFor(pickPolicy(views, pinned), now);
        batch.update(d.ref, { freshUntil: nextFresh });
      }
    });
  }

  // products 側の freshUntil を押し直し
  if (targetAsins.length) await batch.commit();

  // asinQueue へ投入（サイト設定の cooldownDays を採用）
  const siteDoc = await db.collection("sites").doc(siteId).get();
  const cooldownDays = Number(siteDoc.get("discovery.cooldownDays") || 0);

  const n = await enqueueAsins(siteId, targetAsins, {
    cooldownDays,
    forceCooldown: false,
  });

  return n;
}

/** ─── CLI 実行サポート（例: ts-node scripts/enqueueStaleProducts.ts chairscope 200 true） ─── */
async function _mainCli() {
  const siteId = process.argv[2] || "chairscope";
  const limit = Number(process.argv[3] || 500);
  const dry =
    ["1", "true", "yes"].includes(String(process.argv[4]).toLowerCase()) ||
    false;

  if (dry) {
    const n = await enqueueStaleBySite(siteId, limit);
    console.log(`[stale] (dry=false default実行) enqueued=${n}`);
  } else {
    const n = await enqueueStaleBySite(siteId, limit);
    console.log(`[stale] enqueued=${n}`);
  }
}

// Node の標準的な「直接実行時だけ」判定
try {
  if (process?.argv?.[1]?.includes("enqueueStaleProducts")) {
    _mainCli().catch((e) => {
      console.error("[stale] fatal:", e);
      process.exit(1);
    });
  }
} catch {
  // no-op（Cloud Functionsランタイム等）
}
