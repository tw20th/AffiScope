// firebase/functions/src/jobs/updatePrices.ts
import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { getSiteConfig } from "../../lib/sites/siteConfig.js";
import { isStale, computeFreshFor, pickPolicy } from "../../lib/products/staleness.js";
import { shouldBoostHot } from "../../lib/hotBoost.js";

// ★ 新クライアントに統一
import { getItemsOnce, type OfferHit } from "../../services/paapi/client.js";
import { getPaapiOptionsFromSite } from "../../lib/vendors/paapi/paapiOpts.js";

const REGION = "asia-northeast1";

// Secret Manager の値を環境へマウント（client.ts は env を参照）
const AMAZON_ACCESS_KEY = defineSecret("AMAZON_ACCESS_KEY");
const AMAZON_SECRET_KEY = defineSecret("AMAZON_SECRET_KEY");
const AMAZON_PARTNER_TAG = defineSecret("AMAZON_PARTNER_TAG");

if (getApps().length === 0) initializeApp();
const db = getFirestore();

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
  specs?: { features?: string[] };
  tags?: string[];
  offers?: Offer[];
  priceHistory?: PriceHistory[];
  bestPrice?: BestPrice;
  views?: number;
  pinned?: boolean;
  updatedAt?: number;
  freshUntil?: number;
};

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

// 環境値（安全側）
const CHUNK_SIZE = +(process.env.PAAPI_CHUNK_SIZE || 1);
const CHUNK_INTERVAL_MS = +(process.env.PAAPI_INTERVAL_MS || 20000);
const JITTER = +(process.env.PAAPI_JITTER || 0.5);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function updatePricesForSite(siteId: string, limit = 50) {
  const now = Date.now();

  const staleSnap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("freshUntil", "asc")
    .orderBy("updatedAt", "asc")
    .limit(limit)
    .get();

  const docs: QueryDocumentSnapshot[] = [];
  const asins: string[] = [];
  staleSnap.forEach((d) => {
    const asin = d.get("asin");
    const freshUntil = d.get("freshUntil") as number | undefined;
    if (
      typeof asin === "string" &&
      asin.length === 10 &&
      isStale(freshUntil, now)
    ) {
      docs.push(d);
      asins.push(asin);
    }
  });

  if (asins.length === 0) {
    console.log(`[updatePrices] site=${siteId} staleTargets=0`);
    return { siteId, targets: 0, updated: 0 };
  }

  // サイトごとの PA-API 設定
  const siteCfg = await getSiteConfig(siteId);
  const paapiCfg = getPaapiOptionsFromSite(siteCfg || {});

  // まとめて叩く（チャンク＋インターバル）
  const offersMap: Record<string, OfferHit> = {};
  for (let i = 0; i < asins.length; i += CHUNK_SIZE) {
    const chunk = asins.slice(i, i + CHUNK_SIZE);
    const res = await getItemsOnce(chunk, paapiCfg);
    Object.assign(offersMap, res);

    if (i + CHUNK_SIZE < asins.length) {
      const wait = CHUNK_INTERVAL_MS * (1 + (Math.random() * 2 - 1) * JITTER);
      await sleep(Math.ceil(wait));
    }
  }

  let updated = 0;
  const batch = db.batch();

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const data = (d.data() as ProductDoc) ?? {};
    const asin = data.asin;
    const hit = offersMap[asin];
    const now2 = Date.now();

    const currentOffers: Offer[] = Array.isArray(data.offers)
      ? data.offers
      : [];
    const history: PriceHistory[] = Array.isArray(data.priceHistory)
      ? data.priceHistory
      : [];

    if (hit && isNumber(hit.price)) {
      const url = hit.url ?? `https://www.amazon.co.jp/dp/${asin}`;
      const next: Offer = {
        source: "amazon",
        price: hit.price,
        url,
        lastSeenAt: now2,
      };

      const idx = currentOffers.findIndex((o) => o.source === "amazon");
      if (idx >= 0) currentOffers[idx] = { ...currentOffers[idx], ...next };
      else currentOffers.push(next);

      const last = history[history.length - 1];
      if (!last || last.price !== next.price) {
        history.push({ ts: now2, source: "amazon", price: next.price });
      }

      const best = calcBestPrice(currentOffers);

      // hot再評価（discovery.hotBoostRules を適用）
      const text = [data.title, ...(data.specs?.features || [])]
        .filter(Boolean)
        .join(" / ");
      const boost = shouldBoostHot({
        asin,
        seeds: siteCfg?.seeds?.asins,
        price: hit.price,
        futureTags: data.tags || [],
        textForMatch: text,
        rules: siteCfg?.discovery?.hotBoostRules,
      });

      const policy = boost
        ? "hot"
        : pickPolicy(Number(data.views || 0), !!data.pinned);
      const freshUntilNext = computeFreshFor(policy, now2);

      batch.set(
        d.ref,
        {
          offers: currentOffers,
          priceHistory: history,
          bestPrice: best,
          updatedAt: now2,
          freshUntil: freshUntilNext,
        },
        { merge: true }
      );
      updated++;
    } else {
      // 取得失敗・価格なし：鮮度だけ押し直し
      const policy = pickPolicy(Number(data.views || 0), !!data.pinned);
      const freshUntilNext = computeFreshFor(policy, now2);
      batch.set(
        d.ref,
        { updatedAt: now2, freshUntil: freshUntilNext },
        { merge: true }
      );
    }
  }

  if (updated > 0) await batch.commit();
  console.log(
    `[updatePrices] site=${siteId} targets=${docs.length} updated=${updated}`
  );
  return { siteId, targets: docs.length, updated };
}

export const scheduledUpdatePrices = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .pubsub.schedule("every 180 minutes") // ← 3時間に1回
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const sites = await db.collection("sites").get();
    // FOCUS_SITE_ID があればそれ以外をスキップ
    for (const sd of sites.docs) {
      const sId = sd.id;
      if (process.env.FOCUS_SITE_ID && sId !== process.env.FOCUS_SITE_ID)
        continue;
      try {
        const res = await updatePricesForSite(sId, 25); // ← 1回の対象も控えめ
        console.log("[scheduledUpdatePrices] result", res);
      } catch (e) {
        console.error("[scheduledUpdatePrices] failed", sId, e);
      }
    }
  });

export const runUpdatePrices = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const allow = String(
      process.env.ALLOW_MANUAL_QUEUE_RUN || ""
    ).toLowerCase();
    if (!(allow === "1" || allow === "true" || allow === "yes")) {
      res.status(403).json({
        ok: false,
        error: "manual price update is disabled in safe mode",
      });
      return;
    }
    try {
      const siteId = String(req.query.siteId || "").trim();
      if (!siteId)
        return void res
          .status(400)
          .json({ ok: false, error: "siteId query is required" });
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
      const result = await updatePricesForSite(siteId, limit);
      res.json({ ok: true, ...result });
    } catch (e: unknown) {
      console.error("[runUpdatePrices] failed", e);
      res
        .status(500)
        .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
