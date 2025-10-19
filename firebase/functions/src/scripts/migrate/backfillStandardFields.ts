// firebase/functions/src/scripts/backfillStandardFields.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type Opts = {
  siteId: string;
  limit?: number;
  dryRun?: boolean;
};

function makeSlug(siteId: string, asin: string) {
  return `${siteId}_${asin}`;
}

function pickAffiliateUrl(p: any): string | undefined {
  return p?.affiliateUrl || p?.bestPrice?.url || p?.offers?.[0]?.url;
}

function pickLastSeenAt(p: any): number | undefined {
  return (
    p?.lastSeenAt || p?.offers?.[0]?.lastSeenAt || p?.updatedAt || p?.createdAt
  );
}

async function main({ siteId, limit = 1000, dryRun = true }: Opts) {
  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .limit(limit)
    .get();

  const now = Date.now();
  let updates = 0;

  const batch = db.batch();
  snap.forEach((doc) => {
    const p = doc.data() as any;

    const set: Record<string, unknown> = {};

    // slug
    const asin: string | undefined = p.asin;
    if (asin) {
      const want = makeSlug(siteId, asin);
      if (!p.slug || p.slug !== want) set.slug = want;
    }

    // affiliateUrl
    const aff = pickAffiliateUrl(p);
    if (aff && p.affiliateUrl !== aff) set.affiliateUrl = aff;

    // lastSeenAt（検索に便利）
    const lsa = pickLastSeenAt(p);
    if (typeof lsa === "number" && p.lastSeenAt !== lsa) set.lastSeenAt = lsa;

    // availability / inStock（簡易推定：offers が 1 件以上あれば在庫ありと仮定）
    if (Array.isArray(p.offers) && p.offers.length > 0) {
      if (p.inStock !== true) set.inStock = true;
      if (p.availability !== "in_stock") set.availability = "in_stock";
    } else {
      if (p.inStock !== undefined && p.inStock !== false) set.inStock = false;
      if (p.availability !== "unknown") set.availability = "unknown";
    }

    // rating / reviewCount（器だけ先に作る。数値が既にあれば保持）
    if (p.rating !== undefined && typeof p.rating !== "number")
      set.rating = undefined;
    if (p.reviewCount !== undefined && typeof p.reviewCount !== "number")
      set.reviewCount = undefined;

    // categoryId 正規化（例：GPU 混入の簡易検出）
    // タイトルに GPU 語彙があり、椅子語が無い場合は gpu へ
    const title: string = p.title || "";
    const isGpu =
      /(gpu|グラボ|グラフィック|rtx|geforce|pcie|gddr|displayport)/i.test(
        title
      );
    const isChair = /(チェア|椅子|chair)/i.test(title);
    if (p.categoryId === "gaming-chair" && isGpu && !isChair) {
      set.categoryId = "gpu";
    }

    if (Object.keys(set).length > 0) {
      set.updatedAt = now;
      updates++;
      if (!dryRun) batch.set(doc.ref, set, { merge: true });
      else {
        // eslint-disable-next-line no-console
        console.log(`[DRY] ${doc.id}`, set);
      }
    }
  });

  if (!dryRun && updates > 0) await batch.commit();

  // eslint-disable-next-line no-console
  console.log(
    `[backfillStandardFields] site=${siteId} docs=${snap.size} updates=${updates} dryRun=${dryRun}`
  );
}

// CLI:
//   pnpm -C firebase/functions ts-node -P tsconfig.scripts.json src/scripts/backfillStandardFields.ts chairscope true
//   pnpm -C firebase/functions ts-node -P tsconfig.scripts.json src/scripts/backfillStandardFields.ts chairscope
const siteId = process.argv[2] || "chairscope";
const dry = ["1", "true", "yes"].includes(
  String(process.argv[3]).toLowerCase()
);
const limitArg = Number(process.argv[4] || 0);
main({ siteId, dryRun: dry, limit: limitArg > 0 ? limitArg : 1000 }).catch(
  (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  }
);
