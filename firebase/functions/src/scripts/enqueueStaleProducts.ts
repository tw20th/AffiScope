// firebase/functions/src/scripts/enqueueStaleProducts.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const MAX_ATTEMPTS = 5;

function isValidAsin(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}
function qid(siteId: string, asin: string) {
  return `${siteId}_${asin}`;
}

async function safeGetAll(refs: FirebaseFirestore.DocumentReference[]) {
  return Promise.all(refs.map((r) => r.get()));
}

async function enqueueAsins(
  siteId: string,
  asins: string[],
  cooldownDays = 0,
  forceCooldown = false
): Promise<number> {
  const now = Date.now();
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const valid = Array.from(new Set(asins.filter(isValidAsin)));
  if (!valid.length) return 0;

  // 既存 products 除外（＝既存でも再取得はしたいので、除外しない。ここはキュー状態のみ確認）
  const qSnaps = await safeGetAll(
    valid.map((a) => db.collection("asinQueue").doc(qid(siteId, a)))
  );

  const enqueueList: string[] = [];
  qSnaps.forEach((s, i) => {
    const asin = valid[i];
    if (!s.exists) return enqueueList.push(asin);
    const q = s.data() as any;
    const busy = q?.status === "queued" || q?.status === "processing";
    const recent =
      typeof q?.updatedAt === "number" && now - q.updatedAt < cooldownMs;
    const reached =
      (q?.attempts ?? 0) >= MAX_ATTEMPTS || q?.status === "failed";
    if (forceCooldown) {
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
        priority: 0,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
  await batch.commit();
  return enqueueList.length;
}

async function main() {
  const siteId = process.argv[2] || "chairscope";
  const dry = ["1", "true", "yes"].includes(
    String(process.argv[3]).toLowerCase()
  );
  const staleDays = Number(process.argv[4] || 7); // 既定：7日より古い
  const limit = Number(process.argv[5] || 200);
  const force = ["1", "true", "yes"].includes(
    String(process.argv[6]).toLowerCase()
  ); // cooldown無視

  const threshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  // lastSeenAt が無い or 古いものを抽出
  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("lastSeenAt", "asc")
    .limit(Math.max(1, limit))
    .get();

  const targetAsins: string[] = [];
  snap.forEach((d) => {
    const p = d.data() as any;
    const lsa = Number(p.lastSeenAt || 0);
    if (!lsa || lsa < threshold) {
      if (typeof p.asin === "string") targetAsins.push(p.asin);
    }
  });

  if (!targetAsins.length) {
    console.log(`[stale] no targets (<= ${staleDays} days old).`);
    return;
  }

  if (dry) {
    console.log(
      `[DRY][stale] enqueue candidates=${targetAsins.length}`,
      targetAsins.slice(0, 20)
    );
  } else {
    const site = await db.collection("sites").doc(siteId).get();
    const cooldownDays = Number(site.get("discovery.cooldownDays") || 0);
    const n = await enqueueAsins(siteId, targetAsins, cooldownDays, force);
    console.log(`[stale] enqueued=${n}/${targetAsins.length} (force=${force})`);
  }
}

main().catch((e) => {
  console.error("[stale] fatal:", e);
  process.exit(1);
});
