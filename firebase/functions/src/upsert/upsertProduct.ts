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

function db() {
  if (admin.apps.length === 0) admin.initializeApp();
  return getFirestore();
}

export async function upsertProductSeed(i: SeedInput) {
  const ref = db().collection("products").doc(i.asin);
  const snap = await ref.get();
  const now = Date.now();

  const base = {
    asin: i.asin,
    siteId: i.siteId,
    categoryId: i.categoryId,
    title: i.title ?? `商品 ${i.asin}`,
    brand: i.brand ?? undefined,
    imageUrl: i.imageUrl ?? undefined,
    tags: [],
    specs: undefined,
    priceHistory: [] as Array<{
      ts: number;
      source: "amazon" | "rakuten";
      price: number;
    }>,
    views: 0,
  };

  // 価格/オファーを付与
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
      : [];

  const bestPrice =
    i.price && i.url
      ? {
          price: i.price,
          source: "amazon" as const,
          url: i.url,
          updatedAt: now,
        }
      : undefined;

  await ref.set(
    {
      ...base,
      offers,
      ...(bestPrice ? { bestPrice } : {}),
      createdAt: snap.exists ? (snap.data() as any)?.createdAt ?? now : now,
      updatedAt: now,
    },
    { merge: true }
  );
}
