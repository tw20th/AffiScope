// firebase/functions/src/jobs/updatePrices.ts
import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { fetchAmazonOffers } from "../fetchers/amazon/paapi.js";

const REGION = "asia-northeast1";

const AMAZON_ACCESS_KEY = defineSecret("AMAZON_ACCESS_KEY");
const AMAZON_SECRET_KEY = defineSecret("AMAZON_SECRET_KEY");
const AMAZON_PARTNER_TAG = defineSecret("AMAZON_PARTNER_TAG");

// ---- Admin init ----
if (getApps().length === 0) initializeApp();
const db = getFirestore();

// ---- Local types（保存形式に合わせた最小限）----
type Source = "amazon" | "rakuten";
type PriceHistory = { ts: number; source: Source; price: number };
type Offer = { source: Source; price: number; url: string; lastSeenAt: number };
type BestPrice = {
  price: number;
  source: Source;
  url: string;
  updatedAt: number;
};

type ProductDoc = {
  asin: string;
  siteId: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  offers?: Offer[];
  priceHistory?: PriceHistory[];
  bestPrice?: BestPrice;
  updatedAt?: number;
};

// ---- 共通ユーティリティ ----
function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function calcBestPrice(offers: Offer[]): BestPrice | undefined {
  if (!offers.length) return undefined;
  const best = offers.reduce(
    (min, o) => (o.price < min.price ? o : min),
    offers[0]
  );
  return {
    price: best.price,
    source: best.source,
    url: best.url,
    updatedAt: Date.now(),
  };
}

// ------------------------------------------------------------------
// コア処理：指定サイトの product 群の価格を更新
// ------------------------------------------------------------------
export async function updatePricesForSite(siteId: string, limit = 50) {
  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("updatedAt", "asc")
    .limit(limit)
    .get();

  const docs: QueryDocumentSnapshot[] = [];
  const asins: string[] = [];
  snap.forEach((d) => {
    const asin = d.get("asin");
    if (typeof asin === "string" && asin.length === 10) {
      docs.push(d);
      asins.push(asin);
    }
  });

  if (asins.length === 0) {
    console.log(`[updatePrices] site=${siteId} targets=0`);
    return { siteId, targets: 0, updated: 0 };
  }

  // まとめて取得（PA-API）
  const offersMap = await fetchAmazonOffers(asins);

  const now = Date.now();
  let updated = 0;
  const batch = db.batch();

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const data = (d.data() as ProductDoc) ?? {};
    const asin = data.asin;

    const hit = offersMap[asin];
    if (!hit) {
      console.warn("[updatePrices] no offer from PA-API", { siteId, asin });
      continue;
    }

    const currentOffers: Offer[] = Array.isArray(data.offers)
      ? data.offers
      : [];

    // 価格があるときだけ Offer を追加/更新
    if (isNumber(hit.price)) {
      const url = hit.url ?? `https://www.amazon.co.jp/dp/${asin}`;
      const next: Offer = {
        source: "amazon",
        price: hit.price,
        url,
        lastSeenAt: now,
      };

      const idx = currentOffers.findIndex((o) => o.source === "amazon");
      if (idx >= 0) {
        currentOffers[idx] = { ...currentOffers[idx], ...next };
      } else {
        currentOffers.push(next);
      }

      // priceHistory（末尾価格と違うときだけ追加）
      const history: PriceHistory[] = Array.isArray(data.priceHistory)
        ? data.priceHistory
        : [];
      const last = history[history.length - 1];
      if (!last || last.price !== next.price) {
        history.push({ ts: now, source: "amazon", price: next.price });
      }

      const best = calcBestPrice(currentOffers);

      batch.set(
        d.ref,
        {
          offers: currentOffers,
          priceHistory: history,
          bestPrice: best,
          updatedAt: now,
        },
        { merge: true }
      );
      updated++;
    } else {
      // 価格なし：既存の amazon オファーがあれば URL/lastSeenAt だけ更新（URLが来た時のみ上書き）
      const idx = currentOffers.findIndex((o) => o.source === "amazon");
      if (idx >= 0) {
        currentOffers[idx] = {
          ...currentOffers[idx],
          ...(hit.url ? { url: hit.url } : {}),
          lastSeenAt: now,
        };
        batch.set(
          d.ref,
          {
            offers: currentOffers,
            updatedAt: now,
          },
          { merge: true }
        );
        updated++;
      } else {
        // 何もしない（Offer.price は number 必須なので新規は作らない）
        console.log("[updatePrices] skip add (no price)", { siteId, asin });
      }
    }
  }

  if (updated > 0) await batch.commit();
  console.log(
    `[updatePrices] site=${siteId} targets=${docs.length} updated=${updated}`
  );
  return { siteId, targets: docs.length, updated };
}

// ------------------------------------------------------------------
// スケジュール実行
// ------------------------------------------------------------------
export const scheduledUpdatePrices = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const sites = await db.collection("sites").get();
    for (const sd of sites.docs) {
      const sId = sd.id;
      try {
        const res = await updatePricesForSite(sId, 50);
        console.log("[scheduledUpdatePrices] result", res);
      } catch (e) {
        console.error("[scheduledUpdatePrices] failed", sId, e);
      }
    }
  });

// ------------------------------------------------------------------
// 手動実行（siteId / limit）
// ------------------------------------------------------------------
export const runUpdatePrices = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      if (!siteId) {
        res.status(400).json({ ok: false, error: "siteId query is required" });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const result = await updatePricesForSite(siteId, limit);
      res.json({ ok: true, ...result });
    } catch (e: unknown) {
      console.error("[runUpdatePrices] failed", e);
      res
        .status(500)
        .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
