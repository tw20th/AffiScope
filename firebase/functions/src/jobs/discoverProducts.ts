// firebase/functions/src/jobs/discoverProducts.ts
import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { fetchAmazonOffers } from "../fetchers/amazon/paapi.js";
import { searchAmazonItems } from "../fetchers/amazon/search.js";
import {
  mapAmazonItemToProduct,
  type AmazonItem,
} from "../lib/mapAmazonToProduct.js";

// ---- Firebase Admin
if (getApps().length === 0) initializeApp();
const db = getFirestore();

const REGION = "asia-northeast1";
const AMAZON_ACCESS_KEY = defineSecret("AMAZON_ACCESS_KEY");
const AMAZON_SECRET_KEY = defineSecret("AMAZON_SECRET_KEY");
const AMAZON_PARTNER_TAG = defineSecret("AMAZON_PARTNER_TAG");

const MAX_ATTEMPTS = 5;

type Site = {
  id: string;
  affiliate?: { amazon?: { partnerTag?: string } };
  seeds?: { asins?: string[] };
  productRules?: {
    categoryId?: string;
    includeKeywords?: string[];
    excludeKeywords?: string[];
  };
  discovery?: {
    searchKeywords?: string[];
    maxPerRun?: number;
    maxSearchItemPage?: number;
    randomizePage?: boolean;
    relaxedOnFirstImport?: boolean;
    cooldownDays?: number;
    minPrice?: number;
    maxPrice?: number;
    searchIndex?: string; // ★追加
  };
};

function isValidAsin(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}
function qid(siteId: string, asin: string) {
  return `${siteId}_${asin}`;
}
function matchRules(
  title: string,
  rules?: Site["productRules"],
  relaxed = false
) {
  const t = title.toLowerCase();
  if (!relaxed && rules?.includeKeywords?.length) {
    const ok = rules.includeKeywords.some((kw) => t.includes(kw.toLowerCase()));
    if (!ok) return false;
  }
  if (rules?.excludeKeywords?.length) {
    const ng = rules.excludeKeywords.some((kw) => t.includes(kw.toLowerCase()));
    if (ng) return false;
  }
  return true;
}

/** doc.getAll 代替 */
async function safeGetAll(refs: FirebaseFirestore.DocumentReference[]) {
  return Promise.all(refs.map((r) => r.get()));
}

/**
 * ASIN をキューに投入する。戻り値は「実際に新規で queued にできた件数」。
 * opts.forceCooldown=true ならクールダウンを無視して queued に戻す。
 */
export async function enqueueAsins(
  siteId: string,
  asins: string[],
  opts?: { cooldownDays?: number; forceCooldown?: boolean }
): Promise<number> {
  const now = Date.now();
  const cooldownMs = (opts?.cooldownDays || 0) * 24 * 60 * 60 * 1000;

  const valid = Array.from(new Set(asins.filter(isValidAsin)));
  if (!valid.length) return 0;

  // 既存 products 除外
  const prodIds = valid.map((a) => `${siteId}_${a}`);
  let existing = new Set<string>();
  if (prodIds.length) {
    const snaps = await safeGetAll(
      prodIds.map((id) => db.collection("products").doc(id))
    );
    existing = new Set(
      snaps.filter((s) => s.exists).map((s) => s.id.split("_").pop() as string)
    );
  }
  const toCheck = valid.filter((a) => !existing.has(a));
  if (!toCheck.length) return 0;

  // asinQueue の状態を見て投入判定
  const qSnaps = await safeGetAll(
    toCheck.map((a) => db.collection("asinQueue").doc(qid(siteId, a)))
  );
  const enqueueList: string[] = [];
  qSnaps.forEach((s, i) => {
    const asin = toCheck[i];
    if (!s.exists) return enqueueList.push(asin);

    const q = s.data() as any;
    const busy = q?.status === "queued" || q?.status === "processing";
    const recent =
      typeof q?.updatedAt === "number" && now - q.updatedAt < cooldownMs;
    const reached =
      (q?.attempts ?? 0) >= MAX_ATTEMPTS || q?.status === "failed";

    // 手動実行で強制したい場合は cooldown を無視
    if (opts?.forceCooldown) {
      if (!busy && !reached) enqueueList.push(asin);
      return;
    }

    if (!busy && !recent && !reached) enqueueList.push(asin);
  });

  if (!enqueueList.length) return 0;

  const batch = db.batch();
  enqueueList.forEach((asin) => {
    batch.set(
      db.collection("asinQueue").doc(qid(siteId, asin)),
      {
        siteId,
        asin,
        status: "queued",
        attempts: 0,
        priority: 0,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
  await batch.commit();
  return enqueueList.length;
}

async function claimBatch(siteId: string, n: number) {
  const now = Date.now();
  const snap = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .where("status", "==", "queued")
    .where("attempts", "<", MAX_ATTEMPTS)
    .orderBy("priority", "asc")
    .orderBy("updatedAt", "asc")
    .limit(n)
    .get();

  const items: { asin: string; id: string; attempts: number }[] = [];
  const batch = db.batch();
  snap.forEach((d) => {
    items.push({
      asin: d.get("asin"),
      id: d.id,
      attempts: Number(d.get("attempts") || 0),
    });
    batch.update(d.ref, { status: "processing", updatedAt: now });
  });
  if (items.length) await batch.commit();
  return items;
}

export async function discoverForSite(
  site: Site,
  perRun = 25,
  opts?: { relaxed?: boolean }
) {
  const siteId = site.id;

  // seeds
  if (site.seeds?.asins?.length) {
    await enqueueAsins(siteId, site.seeds.asins, {
      cooldownDays: site.discovery?.cooldownDays,
    });
  }

  const claims = await claimBatch(siteId, perRun);
  console.log(`[discover] site=${siteId} claim=${claims.length}`);
  if (!claims.length) return { claimed: 0, upserts: 0 };

  const partnerTag = site.affiliate?.amazon?.partnerTag;
  const result = await fetchAmazonOffers(
    claims.map((c) => c.asin),
    { partnerTag }
  );
  console.log("[discover] offers keys =", Object.keys(result).length);

  const now = Date.now();
  const batch = db.batch();
  let upserts = 0;

  for (const c of claims) {
    const asin = c.asin;
    const qref = db.collection("asinQueue").doc(c.id);
    const data = result[asin];

    if (!data) {
      const nextAttempts = c.attempts + 1;
      const willFail = nextAttempts >= MAX_ATTEMPTS;
      batch.update(qref, {
        status: willFail ? "failed" : "queued",
        attempts: FieldValue.increment(1),
        updatedAt: now,
        ...(willFail
          ? { errorCode: "PAAPI", errorMessage: "Fetch failed (max attempts)" }
          : {}),
      });
      console.warn(
        `[discover] paapi ${
          willFail ? "failed" : "miss -> requeue"
        } ${siteId} ${asin} attempts=${nextAttempts}`
      );
      continue;
    }

    const title = data.title ?? "";
    if (!matchRules(title, site.productRules, !!opts?.relaxed)) {
      batch.update(qref, {
        status: "invalid",
        updatedAt: now,
        errorCode: "INVALID_CATEGORY",
      });
      console.log(`[discover] invalid ${siteId} ${asin} title="${title}"`);
      continue;
    }

    const ai: AmazonItem = {
      ASIN: asin,
      Title: data.title ?? undefined,
      Brand: data.brand ?? undefined,
      ImageUrl: data.imageUrl ?? undefined,
      Price: data.price,
      DetailPageURL: data.url,
    };

    const prod = mapAmazonItemToProduct(ai, {
      siteId,
      categoryId:
        site.productRules?.categoryId ??
        (site as any).categoryPreset?.[0] ??
        "general",
    });

    const docId = `${siteId}_${asin}`;
    const pref = db.collection("products").doc(docId);

    batch.set(pref, prod, { merge: true });
    batch.update(qref, { status: "done", updatedAt: now });

    upserts++;
    console.log(
      `[discover] upsert ${siteId} ${docId} price=${
        data.price
      } image=${!!ai.ImageUrl}`
    );
  }

  await batch.commit();
  return { claimed: claims.length, upserts };
}

// ---------------- Schedules ----------------
export const scheduledDiscoverProducts = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .pubsub.schedule("every 15 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const sites = await db.collection("sites").get();
    for (const sd of sites.docs) {
      const s = { id: sd.id, ...(sd.data() as any) } as Site;
      try {
        const res = await discoverForSite(s, s.discovery?.maxPerRun ?? 25, {
          relaxed: !!s.discovery?.relaxedOnFirstImport,
        });
        console.log(`[discover] scheduled result site=${s.id}`, res);
      } catch (e) {
        console.error("[discover] failed", s.id, e);
      }
    }
  });

export const scheduledDiscoverFromSearch = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .pubsub.schedule("every 12 hours")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const sites = await db.collection("sites").get();
    for (const sd of sites.docs) {
      const s = { id: sd.id, ...(sd.data() as any) } as Site;
      const disc = s.discovery || {};
      const kws = disc.searchKeywords || [];
      if (!kws.length) continue;

      const sIndex = disc.searchIndex || "OfficeProducts"; // ★追加（既定）
      const maxPage = Math.max(1, Math.min(10, disc.maxSearchItemPage || 3));
      const randomize = !!disc.randomizePage;
      const perRun = Math.min(25, disc.maxPerRun || 25);
      const minP = disc.minPrice ?? 0;
      const maxP = disc.maxPrice ?? Number.MAX_SAFE_INTEGER;

      try {
        for (const kw of kws) {
          const page = randomize ? 1 + Math.floor(Math.random() * maxPage) : 1;
          const items = await searchAmazonItems(kw, 10, page, {
            sortBy: "Featured",
            searchIndex: sIndex, // ★ここで渡す
          });
          const asins = Array.from(
            new Set(
              items
                .filter((i) => (i.price ?? 0) >= minP && (i.price ?? 0) <= maxP)
                .map((i) => i.asin)
            )
          );
          await enqueueAsins(s.id, asins, { cooldownDays: disc.cooldownDays });
        }
        await discoverForSite(s, perRun, {
          relaxed: !!disc.relaxedOnFirstImport,
        });
      } catch (e) {
        console.error("[discoverFromSearch] failed", s.id, e);
      }
    }
  });

// ---------------- Manual (GET/POST) ----------------
export const runDiscoverNow = functions
  .runWith({
    secrets: [AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG],
    timeoutSeconds: 540,
    memory: "512MB",
  })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || req.body?.siteId || "").trim();
      if (!siteId)
        return void res
          .status(400)
          .json({ ok: false, error: "siteId query is required" });

      const sdoc = await db.collection("sites").doc(siteId).get();
      if (!sdoc.exists)
        return void res
          .status(404)
          .json({ ok: false, error: `site not found: ${siteId}` });

      const site = { id: sdoc.id, ...(sdoc.data() as any) } as Site;
      const disc = site.discovery || {};
      const limit = Math.min(
        Math.max(Number(req.query.limit || req.body?.limit) || 10, 1),
        25
      );
      const keyword = String(
        req.query.keyword || req.body?.keyword || ""
      ).trim();
      const page =
        Number(req.query.page || req.body?.page) ||
        (disc.randomizePage
          ? 1 +
            Math.floor(Math.random() * Math.max(1, disc.maxSearchItemPage || 3))
          : 1);
      const relaxed =
        ["1", "true", "yes"].includes(
          String(req.query.relaxed || req.body?.relaxed).toLowerCase()
        ) ||
        (!!disc.relaxedOnFirstImport &&
          !(req.query.relaxed || req.body?.relaxed));

      const searchIndex = String(
        req.query.searchIndex ||
          req.body?.searchIndex ||
          disc.searchIndex ||
          "OfficeProducts"
      ).trim(); // ★追加

      let enqKeyword = 0,
        enqDirect = 0;

      if (keyword) {
        const items = await searchAmazonItems(
          keyword,
          Math.min(limit, 10),
          page,
          {
            sortBy: "Featured",
            searchIndex,
          }
        );
        const minP = disc.minPrice ?? 0;
        const maxP = disc.maxPrice ?? Number.MAX_SAFE_INTEGER;
        const asins = Array.from(
          new Set(
            items
              .filter((i) => (i.price ?? 0) >= minP && (i.price ?? 0) <= maxP)
              .map((i) => i.asin)
          )
        );
        await enqueueAsins(siteId, asins, { cooldownDays: disc.cooldownDays });
        enqKeyword = asins.length;
      }

      const asinsParam = String(
        req.query.asins || req.body?.asins || ""
      ).trim();
      if (asinsParam) {
        const asins = asinsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        await enqueueAsins(siteId, asins, { cooldownDays: disc.cooldownDays });
        enqDirect = asins.length;
      }

      const result = await discoverForSite(site, limit, { relaxed });
      res.json({
        ok: true,
        enqueued: enqKeyword + enqDirect,
        ...result,
        relaxed,
        keyword,
        page,
      });
    } catch (e: any) {
      console.error(
        "[runDiscoverNow] failed",
        e?.status,
        e?.response?.data || e?.message || e
      );
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });
