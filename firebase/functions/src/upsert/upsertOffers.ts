// firebase/functions/src/upsert/upsertOffers.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

type OfferInput = { price: number; url: string };
const DEFAULT_SITE_ID = process.env.SITE_ID || "affiscope";

function db() {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

/** 既存 doc でも siteId が欠けていたら補完する。 */
export async function upsertOffers(
  asin: string,
  offer: OfferInput,
  siteId = DEFAULT_SITE_ID
) {
  const ref = db().collection("products").doc(asin);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    await ref.set(
      {
        asin,
        siteId, // ← 必須!!
        title: `商品 ${asin}`,
        brand: "Unknown",
        imageUrl: "https://placehold.co/400x300?text=No+Image",
        categoryId: "mobile-battery",
        offers: [
          {
            source: "amazon",
            price: offer.price,
            url: offer.url,
            lastSeenAt: now,
          },
        ],
        priceHistory: [{ ts: now, source: "amazon", price: offer.price }],
        bestPrice: {
          price: offer.price,
          source: "amazon",
          url: offer.url,
          updatedAt: now,
        },
        views: 0,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    return;
  }

  const data = snap.data() || {};
  const offers = Array.isArray((data as any).offers)
    ? (data as any).offers
    : [];
  const newOffers = [
    ...offers.filter((o: any) => o.source !== "amazon"),
    { source: "amazon", price: offer.price, url: offer.url, lastSeenAt: now },
  ];

  const best = newOffers.reduce(
    (min: any, o: any) => (o.price < min.price ? o : min),
    newOffers[0]
  );

  const priceHistory = Array.isArray((data as any).priceHistory)
    ? (data as any).priceHistory
    : [];
  const last = priceHistory[priceHistory.length - 1];
  if (!last || last.price !== offer.price) {
    priceHistory.push({ ts: now, source: "amazon", price: offer.price });
  }

  await ref.set(
    {
      siteId: (data as any).siteId || siteId, // ← 既存 doc が欠けていたら補完
      offers: newOffers,
      bestPrice: {
        price: best.price,
        source: best.source,
        url: best.url,
        updatedAt: now,
      },
      priceHistory,
      updatedAt: now,
    },
    { merge: true }
  );
}
