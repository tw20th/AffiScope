// firebase/functions/src/jobs/updatePrices.ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { fetchAmazonOffers } from "../fetchers/amazon/paapi";
import type { Offer } from "@affiscope/shared-types";

const AMAZON_ACCESS_KEY = defineSecret("AMAZON_ACCESS_KEY");
const AMAZON_SECRET_KEY = defineSecret("AMAZON_SECRET_KEY");
const AMAZON_PARTNER_TAG = defineSecret("AMAZON_PARTNER_TAG");

type OfferSource = "amazon" | "rakuten";

function pushPricePoint(
  priceHistory: Array<{ ts: number; source: OfferSource; price: number }>,
  now: number,
  best: { source: OfferSource; price: number } | null
) {
  if (!best) return;
  const last = priceHistory[priceHistory.length - 1];
  if (!last || last.price !== best.price || last.source !== best.source) {
    priceHistory.push({ ts: now, source: best.source, price: best.price });
  }
  if (priceHistory.length > 100) {
    priceHistory.splice(0, priceHistory.length - 100);
  }
}

const SITE_ID = process.env.SITE_ID || "affiscope";
const MAX_PER_RUN = +(process.env.MAX_PRODUCTS_PER_RUN || 100);

export async function updatePricesOnce(): Promise<void> {
  const db = admin.firestore();

  const snap = await db
    .collection("products")
    .where("siteId", "==", SITE_ID)
    .orderBy("updatedAt", "asc")
    .limit(MAX_PER_RUN)
    .get();

  if (snap.empty) {
    console.log("[updatePricesOnce] no products");
    return;
  }

  const docs = snap.docs;
  const asins = docs.map((d) => (d.get("asin") as string) || d.id);

  let pa: Record<
    string,
    { price: number; url: string; title?: string; brand?: string } | null
  > = {};
  // ここは throw しない実装（fetchAmazonOffers 側で吸収）
  pa = await fetchAmazonOffers(asins);

  const now = Date.now();

  await Promise.all(
    docs.map(async (doc) => {
      try {
        const p = doc.data() as any;
        const asin: string = p.asin || doc.id;

        const offers: Offer[] = (Array.isArray(p.offers) ? p.offers : []).map(
          (o: any) => ({
            source: o.source as OfferSource,
            price: Number(o.price),
            url: String(o.url),
            lastSeenAt: typeof o.lastSeenAt === "number" ? o.lastSeenAt : 0,
          })
        );

        const a = pa[asin];
        if (a) {
          const idx = offers.findIndex((x) => x.source === "amazon");
          const next = {
            source: "amazon" as const,
            price: a.price,
            url: a.url,
            lastSeenAt: now,
          };
          if (idx >= 0) offers[idx] = { ...offers[idx], ...next };
          else offers.push(next);
        }

        const best =
          offers.length > 0
            ? offers.reduce((min, o) => (o.price < min.price ? o : min))
            : null;

        const priceHistory = Array.isArray(p.priceHistory)
          ? p.priceHistory
          : [];
        pushPricePoint(priceHistory, now, best);

        await doc.ref.set(
          {
            offers,
            bestPrice: best
              ? {
                  price: best.price,
                  source: best.source,
                  url: best.url,
                  updatedAt: now,
                }
              : admin.firestore.FieldValue.delete(),
            priceHistory,
            updatedAt: now,
          },
          { merge: true }
        );
      } catch (e) {
        console.error("[updatePricesOnce] update doc failed:", doc.id, e);
      }
    })
  );
}

// スケジュール（東京）
export const scheduledUpdatePrices = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region("asia-northeast1")
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    await updatePricesOnce(); // ★ 引数なしで呼ぶ
  });

export const runUpdatePrices = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region("asia-northeast1")
  .https.onRequest(async (_req, res) => {
    try {
      console.log(
        "[runUpdatePrices] ENV",
        "AK:",
        !!process.env.AMAZON_ACCESS_KEY,
        "SK:",
        !!process.env.AMAZON_SECRET_KEY,
        "TAG:",
        !!process.env.AMAZON_PARTNER_TAG,
        "SITE_ID:",
        process.env.SITE_ID
      );
      await updatePricesOnce(); // ★ 引数なし
      res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error("[runUpdatePrices] failed:", e?.stack || e);
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });
