// firebase/functions/src/upsert/upsertProduct.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

type SeedInput = {
  asin: string;
  siteId: string;
  categoryId: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  price?: number;
  url?: string;
};

// ---- Firestore 初期化（settings() は使わない）----
let _store: FirebaseFirestore.Firestore | null = null;
function db() {
  if (admin.apps.length === 0) admin.initializeApp();
  if (!_store) _store = getFirestore();
  return _store;
}

// ---- undefined を落とす ----
function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export async function upsertProductSeed(i: SeedInput) {
  const store = db();
  const ref = store.collection("products").doc(i.asin);
  const snap = await ref.get();
  const now = Date.now();

  const base = pruneUndefined({
    asin: i.asin,
    siteId: i.siteId,
    categoryId: i.categoryId,
    title: i.title ?? `商品 ${i.asin}`,
    brand: i.brand,
    imageUrl: i.imageUrl,
    tags: [] as string[],
    priceHistory: [] as Array<{
      ts: number;
      source: "amazon" | "rakuten";
      price: number;
    }>,
    views: 0,
  });

  const offers =
    i.price && i.url
      ? [
          {
            source: "amazon" as const,
            price: i.price,
            url: i.url,
            lastSeenAt: now,
          },
        ]
      : undefined;

  const bestPrice =
    i.price && i.url
      ? {
          price: i.price,
          source: "amazon" as const,
          url: i.url,
          updatedAt: now,
        }
      : undefined;

  const payload = pruneUndefined({
    ...base,
    offers,
    bestPrice,
    createdAt: snap.exists ? (snap.data() as any)?.createdAt ?? now : now,
    updatedAt: now,
  });

  await ref.set(payload, { merge: true });
}
