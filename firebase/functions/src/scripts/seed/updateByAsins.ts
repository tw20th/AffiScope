// firebase/functions/src/scripts/updateByAsins.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { getItemsOnce, type OfferHit } from "../../services/paapi/client.js";
import { getSiteConfig } from "../../lib/sites/siteConfig.js";
import { getPaapiOptionsFromSite } from "../../lib/vendors/paapi/paapiOpts.js";
import { upsertOffers } from "../../upsert/upsertOffers.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

async function main() {
  const [siteId, ...asins] = process.argv.slice(2).filter(Boolean);
  if (!siteId || asins.length === 0) {
    console.error(
      "Usage: pnpm -C firebase/functions exec tsx src/scripts/updateByAsins.ts <siteId> <ASIN...>"
    );
    process.exit(1);
  }

  const siteCfg = await getSiteConfig(siteId);
  const paapiCfg = getPaapiOptionsFromSite(siteCfg || {});

  const result = (await getItemsOnce(asins, paapiCfg)) as Record<
    string,
    OfferHit
  >;

  for (const asin of asins) {
    const hit = result[asin] as OfferHit | undefined;

    console.log("[debug]", asin, {
      hasFeatures: !!hit?.features?.length,
      hasDims: !!hit?.dimensions,
      material: hit?.material,
      merchant: hit?.merchant,
      offerCount: hit?.offerCount,
    });

    if (!hit) {
      console.warn("no offer:", asin);
      continue;
    }

    // 1) 価格があれば offers / priceHistory を更新
    if (isNumber(hit.price)) {
      const url = hit.url ?? `https://www.amazon.co.jp/dp/${asin}`;
      await upsertOffers(asin, { price: hit.price, url }, siteId);
      console.log("[offer] upsert:", siteId, asin, hit.price);
    } else {
      console.log("[offer] skip (no price):", asin);
    }

    // 2) 付随情報を products にマージ（title/brand/image/specs/trust）
    const ref = db.collection("products").doc(`${siteId}_${asin}`);
    const now = Date.now();

    const patch: Record<string, unknown> = {
      siteId,
      asin,
      updatedAt: now,
    };
    if (hit.title) patch["title"] = hit.title;
    if (hit.brand) patch["brand"] = hit.brand;
    if (hit.imageUrl) patch["imageUrl"] = hit.imageUrl;
    if (hit.url && isNumber(hit.price)) {
      patch["bestPrice"] = {
        price: hit.price,
        source: "amazon",
        url: hit.url,
        updatedAt: now,
      };
    }

    if (hit.features || hit.dimensions || hit.material) {
      patch["specs"] = {
        ...(hit.dimensions ? { dimensions: hit.dimensions } : {}),
        ...(hit.material ? { material: hit.material } : {}),
        ...(hit.features ? { features: hit.features } : {}),
      };
    }

    const merchant =
      typeof hit.merchant === "string" ? hit.merchant : undefined;
    const offerCount =
      typeof hit.offerCount === "number" ? hit.offerCount : undefined;

    if (merchant || typeof offerCount === "number") {
      patch["trust"] = {
        ...(merchant ? { merchant } : {}),
        ...(typeof offerCount === "number" ? { offerCount } : {}),
      };
    }

    await ref.set(
      { categoryId: "gaming-chair", ...patch, createdAt: now },
      { merge: true }
    );
    console.log("[product] merged:", `${siteId}_${asin}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
