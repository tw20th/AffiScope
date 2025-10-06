// firebase/functions/src/jobs/processAsinQueue.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { fetchAmazonOffers } from "../fetchers/amazon/paapi.js";
import { retagBySiteRules } from "../lib/tagging.js";
import { buildAiSummary } from "../lib/summary.js";
import { getSiteConfig } from "../lib/siteConfig.js";
import { normalizeProductFromOffer } from "../lib/normalize.js";

type QueueDoc = {
  siteId: string;
  asin: string;
  status: "queued" | "running" | "done" | "error";
  priority?: number;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number;
  error?: string;
};

const REGION = "asia-northeast1";
const TZ = "Asia/Tokyo";
const BATCH_SIZE = +(process.env.QUEUE_BATCH_SIZE || 20);
const MAX_ATTEMPTS = +(process.env.QUEUE_MAX_ATTEMPTS || 3);

const now = () => Date.now();

function buildAffiliateUrl(asin: string, partnerTag?: string) {
  const tag = partnerTag || process.env.AMAZON_PARTNER_TAG || "";
  const base = `https://www.amazon.co.jp/dp/${asin}`;
  return tag ? `${base}?tag=${tag}&linkCode=ogi&th=1&psc=1` : base;
}

async function pickQueueDocs(db: FirebaseFirestore.Firestore) {
  // status=queued を優先取得（firestore.indexes.json に対応 index を追加済み想定）
  const snap = await db
    .collectionGroup("asinQueue")
    .where("status", "==", "queued")
    .orderBy("siteId", "asc")
    .orderBy("priority", "asc")
    .orderBy("attempts", "asc")
    .orderBy("updatedAt", "asc")
    .limit(BATCH_SIZE)
    .get();

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
        status: "running",
        attempts: (data.attempts || 0) + 1,
        updatedAt: now(),
      } as Partial<QueueDoc>);
      locked.push({ ref, data: { ...data, status: "running" } });
    }
  });
  return locked;
}

export async function processOnce(): Promise<{
  taken: number;
  done: number;
  failed: number;
}> {
  const db = getFirestore();
  const picked = await pickQueueDocs(db);
  if (picked.length === 0) return { taken: 0, done: 0, failed: 0 };

  const locked = await lockDocs(db, picked);
  if (locked.length === 0) return { taken: 0, done: 0, failed: 0 };

  // siteId ごとにまとめて取得
  const grouped = new Map<string, { asins: string[]; items: typeof locked }>();
  for (const it of locked) {
    const g = grouped.get(it.data.siteId) || {
      asins: [],
      items: [] as typeof locked,
    };
    g.asins.push(it.data.asin);
    g.items.push(it);
    grouped.set(it.data.siteId, g);
  }

  let ok = 0;
  let ng = 0;

  for (const [siteId, group] of grouped) {
    const site = await getSiteConfig(siteId);
    const partnerTag =
      site?.affiliate?.amazon?.partnerTag || process.env.AMAZON_PARTNER_TAG;

    let offers: Record<string, any>;
    try {
      offers = await fetchAmazonOffers(group.asins, { partnerTag });
    } catch (e: any) {
      await Promise.all(
        group.items.map(({ ref }) =>
          ref.update({
            status: "error",
            updatedAt: now(),
            error: `fetchAmazonOffers failed: ${e?.message || String(e)}`,
          } as Partial<QueueDoc>)
        )
      );
      ng += group.items.length;
      continue;
    }

    const batch = db.batch();

    for (const { ref, data: q } of group.items) {
      try {
        const offer = offers[q.asin] || null;

        // ベース
        const baseDoc: any = {
          siteId,
          asin: q.asin,
          slug: `${siteId}_${q.asin}`,
          affiliateUrl: buildAffiliateUrl(q.asin, partnerTag),
          lastSeenAt: now(),
          updatedAt: now(),
        };

        // offer → product 正規化
        if (offer)
          Object.assign(baseDoc, normalizeProductFromOffer(q.asin, offer));

        // タグ
        const tags = await retagBySiteRules(siteId, baseDoc);
        if (tags?.length) baseDoc.tags = tags;

        // 要約
        baseDoc.aiSummary = buildAiSummary({
          title: baseDoc.title,
          tags: baseDoc.tags || [],
          price: baseDoc.bestPrice?.price ?? baseDoc.price ?? undefined,
        });

        // upsert
        const prodRef = db.collection("products").doc(`${siteId}_${q.asin}`);
        batch.set(prodRef, baseDoc, { merge: true });

        // queue -> done
        batch.update(ref, {
          status: "done",
          updatedAt: now(),
        } as Partial<QueueDoc>);
        ok++;
      } catch (e: any) {
        const attempts = q.attempts || 1;
        const status: QueueDoc["status"] =
          attempts >= MAX_ATTEMPTS ? "error" : "queued";
        batch.update(ref, {
          status,
          updatedAt: now(),
          error: e?.message || String(e),
        } as Partial<QueueDoc>);
        ng++;
      }
    }

    await batch.commit();
  }

  return { taken: locked.length, done: ok, failed: ng };
}

// ─ スケジュール（15分ごと）
export const scheduledProcessAsinQueue = functions
  .region(REGION)
  .pubsub.schedule("every 15 minutes")
  .timeZone(TZ)
  .onRun(async () => {
    const r = await processOnce();
    console.log("[queue] result:", r);
  });

// ─ 手動トリガ
export const runProcessAsinQueue = functions
  .region(REGION)
  .https.onRequest(async (_req, res) => {
    try {
      const r = await processOnce();
      res.status(200).json(r);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
