import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { CatalogProduct, Offer } from "../../lib/catalog/types.js";
import { makeDedupeKey } from "../../lib/catalog/dedupe.js";
import { mergeCatalog } from "../../lib/catalog/merge.js";
import { enrichForSite } from "../../services/enrich/extractSpecs.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type RawDoc = {
  siteId: string;
  itemCode?: string;
  itemUrl: string;
  affiliateUrl?: string;
  shopName?: string;
  title: string;
  price: number;
  imageUrl?: string;
  fetchedAt: number;
  updatedAt: number;
  source: "rakuten";
};

/** raw → catalog 1件 変換 */
function toCatalogUnit(raw: RawDoc, now: number): CatalogProduct {
  const dedupeKey = makeDedupeKey(raw.title);
  const offer: Offer = {
    source: "rakuten",
    price: raw.price,
    url: raw.affiliateUrl ?? raw.itemUrl,
    shopName: raw.shopName,
    itemCode: raw.itemCode,
    lastSeenTs: now,
  };

  // siteごとの軽い enrich（容量/出力など）
  const enr = enrichForSite({
    siteId: raw.siteId,
    title: raw.title,
    categoryIdFallback: "auto",
  });
  const capacity =
    enr.specs?.capacity_mAh || enr.specs?.capacity_Wh
      ? { mAh: enr.specs?.capacity_mAh, Wh: enr.specs?.capacity_Wh }
      : undefined;

  return {
    dedupeKey,
    productName: raw.title,
    brand: raw.shopName,
    imageUrl: raw.imageUrl,
    price: raw.price,
    affiliateUrl: offer.url,
    offers: [offer],
    priceHistory:
      raw.price > 0 ? [{ ts: now, source: "rakuten", price: raw.price }] : [],
    capacity,
    outputPower: enr.specs?.maxOutputW ?? enr.specs?.acOutputW,
    weight: undefined,
    hasTypeC: /usb[-\s]?c|type[-\s]?c|pd/iu.test(raw.title),
    tags: [],
    category: null,
    pains: [],
    aiSummary: "",
    createdAt: now,
    updatedAt: now,
  };
}

export async function buildCatalogFromRaw(
  limit = 500
): Promise<{
  scanned: number;
  upserted: number;
  merged: number;
  skipped: number;
}> {
  const now = Date.now();
  const rawRef = db.collection("raw").doc("rakuten").collection("items");
  const catRef = db.collection("catalog").doc("products").collection("items");

  const rawSnap = await rawRef.orderBy("updatedAt", "desc").limit(limit).get();

  let scanned = 0,
    upserted = 0,
    merged = 0,
    skipped = 0;

  for (const d of rawSnap.docs) {
    scanned++;
    const raw = d.data() as RawDoc;
    if (!raw.title || !Number.isFinite(raw.price)) {
      skipped++;
      continue;
    }

    const incoming = toCatalogUnit(raw, now);
    const ref = catRef.doc(incoming.dedupeKey);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set(incoming, { merge: false });
      upserted++;
    } else {
      const ex = snap.data() as CatalogProduct;
      const m = mergeCatalog(ex, incoming, now);
      await ref.set(m, { merge: false });
      merged++;
    }
  }
  return { scanned, upserted, merged, skipped };
}
