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
      asin: i.asin,
      siteId: i.siteId,
      categoryId: i.categoryId,
      title: i.title ?? `商品 ${i.asin}`,
      brand: i.brand ?? undefined,
      imageUrl: i.imageUrl ?? undefined,
      tags: [],
      specs: undefined,
      offers,
      ...(bestPrice ? { bestPrice } : {}),
      priceHistory: i.price
        ? [{ ts: now, source: "amazon" as const, price: i.price }]
        : [],
      views: (snap.data() as any)?.views ?? 0,
      createdAt: snap.exists ? (snap.data() as any)?.createdAt ?? now : now,
      updatedAt: now,
    },
    { merge: true }
  );
}
