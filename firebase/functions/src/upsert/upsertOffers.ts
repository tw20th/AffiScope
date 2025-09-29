// firebase/functions/src/upsert/upsertOffers.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

type OfferInput = { price?: number; url: string };
const DEFAULT_SITE_ID = process.env.SITE_ID || "affiscope";

function db() {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

export async function upsertOffers(
  asin: string,
  offer: OfferInput,
  siteId = DEFAULT_SITE_ID
) {
  const now = Date.now();
  const id = `${siteId}_${asin}`;
  const ref = db().collection("products").doc(id);
  const snap = await ref.get();

  const hasPrice = typeof offer.price === "number";

  if (!snap.exists) {
    await ref.set(
      {
        asin,
        siteId,
        title: `商品 ${asin}`,
        brand: "Unknown",
        imageUrl: "https://placehold.co/400x300?text=No+Image",
        categoryId: "mobile-battery",
        offers: hasPrice
          ? [
              {
                source: "amazon",
                price: offer.price!,
                url: offer.url,
                lastSeenAt: now,
              },
            ]
          : [],
        priceHistory: hasPrice
          ? [{ ts: now, source: "amazon", price: offer.price! }]
          : [],
        bestPrice: hasPrice
          ? {
              price: offer.price!,
              source: "amazon",
              url: offer.url,
              updatedAt: now,
            }
          : undefined,
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
  const others = offers.filter((o: any) => o.source !== "amazon");
  const newAmazon = hasPrice
    ? [
        {
          source: "amazon",
          price: offer.price!,
          url: offer.url,
          lastSeenAt: now,
        },
      ]
    : [];

  const newOffers = [...others, ...newAmazon];

  // bestPrice は価格があるときだけ再計算
  let best = (data as any).bestPrice ?? null;
  if (newOffers.length > 0) {
    best = newOffers.reduce(
      (min: any, o: any) =>
        min && typeof min.price === "number" && min.price <= o.price ? min : o,
      null as any
    );
  }

  const priceHistory = Array.isArray((data as any).priceHistory)
    ? (data as any).priceHistory
    : [];
  if (hasPrice) {
    const last = priceHistory[priceHistory.length - 1];
    if (!last || last.price !== offer.price) {
      priceHistory.push({ ts: now, source: "amazon", price: offer.price! });
    }
  }

  await ref.set(
    {
      siteId: (data as any).siteId || siteId,
      offers: newOffers,
      bestPrice: best
        ? {
            price: best.price,
            source: best.source,
            url: best.url,
            updatedAt: now,
          }
        : (data as any).bestPrice ?? undefined,
      priceHistory,
      updatedAt: now,
    },
    { merge: true }
  );
}
