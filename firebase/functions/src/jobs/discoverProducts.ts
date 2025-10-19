import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { db } from "../lib/db.js";
import { searchAmazonItems } from "../fetchers/amazon/search.js";

const REGION = "asia-northeast1";
const AMAZON_ACCESS_KEY = defineSecret("AMAZON_ACCESS_KEY");
const AMAZON_SECRET_KEY = defineSecret("AMAZON_SECRET_KEY");
const AMAZON_PARTNER_TAG = defineSecret("AMAZON_PARTNER_TAG");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Site = {
  id: string;
  affiliate?: {
    amazon?: {
      partnerTag?: string;
      marketplace?:
        | "JP"
        | "US"
        | "UK"
        | "DE"
        | "FR"
        | "CA"
        | "IT"
        | "ES"
        | "IN";
    };
  };
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
    cooldownDays?: number;
    minPrice?: number;
    maxPrice?: number;
    searchIndex?: string;
  };
};

function isValidAsin(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{10}$/.test(s);
}

async function safeGetAll(refs: FirebaseFirestore.DocumentReference[]) {
  return Promise.all(refs.map((r) => r.get()));
}

/** 既存のキューに ASIN を積む */
export async function enqueueAsins(
  siteId: string,
  asins: string[],
  opts?: { cooldownDays?: number }
): Promise<number> {
  const now = Date.now();
  const cooldownMs = (opts?.cooldownDays || 0) * 24 * 60 * 60 * 1000;
  const valid = Array.from(new Set(asins.filter(isValidAsin)));
  if (!valid.length) return 0;

  // 既存 product ドキュメントと重複を除く
  const prodRefs = valid.map((a) =>
    db.collection("products").doc(`${siteId}_${a}`)
  );
  const prodSnaps = await safeGetAll(prodRefs);
  const existingAsins = new Set(
    prodSnaps
      .filter((s) => s.exists)
      .map((s) => s.id.split("_").pop() as string)
  );

  const toCheck = valid.filter((a) => !existingAsins.has(a));
  if (!toCheck.length) return 0;

  const qRefs = toCheck.map((a) =>
    db.collection("asinQueue").doc(`${siteId}_${a}`)
  );
  const qSnaps = await safeGetAll(qRefs);

  const enqueueList: string[] = [];
  qSnaps.forEach((s, i) => {
    const asin = toCheck[i];
    if (!s.exists) return enqueueList.push(asin);
    const q = s.data() as any;
    const busy = q?.status === "queued" || q?.status === "processing";
    const recent =
      typeof q?.updatedAt === "number" && now - q.updatedAt < cooldownMs;
    const reached = (q?.attempts ?? 0) >= 5 || q?.status === "failed";
    if (!busy && !recent && !reached) enqueueList.push(asin);
  });

  if (!enqueueList.length) return 0;

  const batch = db.batch();
  enqueueList.forEach((asin) => {
    batch.set(
      db.collection("asinQueue").doc(`${siteId}_${asin}`),
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

/** include/exclude の簡易フィルタ（検索結果用） */
function shouldKeepByProductRules(
  title: string | undefined,
  rules?: Site["productRules"]
): boolean {
  if (!rules) return true;
  const t = (title || "").toLowerCase();
  const inc = rules.includeKeywords || [];
  const exc = rules.excludeKeywords || [];
  if (exc.length && exc.some((kw) => t.includes(kw.toLowerCase())))
    return false;
  if (inc.length && inc.some((kw) => t.includes(kw.toLowerCase()))) return true;
  return inc.length === 0;
}

/** ★ enqueue だけ（取得・保存は processAsinQueue.ts が担当） */
export async function discoverForSite(site: Site, perRun = 25) {
  const siteId = site.id;
  const disc = site.discovery || {};
  let enqueued = 0;

  // seeds
  if (site.seeds?.asins?.length) {
    enqueued += await enqueueAsins(siteId, site.seeds.asins, {
      cooldownDays: disc.cooldownDays,
    });
  }

  // 検索 → ASIN 抽出 → enqueue
  const kws = disc.searchKeywords || [];
  const sIndex = disc.searchIndex || "OfficeProducts";
  const maxPage = Math.max(1, Math.min(10, disc.maxSearchItemPage || 3));
  const randomize = !!disc.randomizePage;
  const minP = disc.minPrice ?? 0;
  const maxP = disc.maxPrice ?? Number.MAX_SAFE_INTEGER;

  const globalSet = new Set<string>();
  for (const kw of kws) {
    if (globalSet.size >= perRun) break;
    const page = randomize ? 1 + Math.floor(Math.random() * maxPage) : 1;
    const items = await searchAmazonItems(kw, 10, page, {
      sortBy: "Featured",
      searchIndex: sIndex,
      partnerTag: site.affiliate?.amazon?.partnerTag,
      marketplace: (site.affiliate?.amazon?.marketplace as any) || "JP",
    });
    const filtered = items
      .filter((i) => (i.price ?? 0) >= minP && (i.price ?? 0) <= maxP)
      .filter((i) => shouldKeepByProductRules(i.title, site.productRules));
    for (const it of filtered) {
      if (globalSet.size >= perRun) break;
      if (it.asin) globalSet.add(it.asin);
    }
    await sleep(1200);
  }

  const asins = Array.from(globalSet);
  if (asins.length)
    enqueued += await enqueueAsins(siteId, asins, {
      cooldownDays: disc.cooldownDays,
    });

  return { claimed: 0, upserts: 0, enqueued };
}

export const scheduledDiscoverProducts = functions
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
      const s = { id: sd.id, ...(sd.data() as any) } as Site;
      try {
        const res = await discoverForSite(s, s.discovery?.maxPerRun ?? 25);
        console.log(`[discover] scheduled result site=${s.id}`, res);
      } catch (e) {
        console.error("[discover] failed", s.id, e);
      }
    }
  });

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
      const searchIndex = String(
        req.query.searchIndex ||
          req.body?.searchIndex ||
          disc.searchIndex ||
          "OfficeProducts"
      ).trim();

      let enqKeyword = 0;
      let enqDirect = 0;

      if (keyword) {
        const items = await searchAmazonItems(
          keyword,
          Math.min(limit, 10),
          page,
          {
            sortBy: "Featured",
            searchIndex,
            partnerTag: site.affiliate?.amazon?.partnerTag,
            marketplace: (site.affiliate?.amazon?.marketplace as any) || "JP",
          }
        );

        const minP = disc.minPrice ?? 0;
        const maxP = disc.maxPrice ?? Number.MAX_SAFE_INTEGER;
        const filtered = items
          .filter((i) => (i.price ?? 0) >= minP && (i.price ?? 0) <= maxP)
          .filter((i) => shouldKeepByProductRules(i.title, site.productRules));

        const asins = Array.from(
          new Set(filtered.map((i) => i.asin).filter(Boolean))
        ) as string[];
        enqKeyword = await enqueueAsins(siteId, asins, {
          cooldownDays: disc.cooldownDays,
        });
      }

      const asinsParam = String(
        req.query.asins || req.body?.asins || ""
      ).trim();
      if (asinsParam) {
        const asins = asinsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        enqDirect = await enqueueAsins(siteId, asins, {
          cooldownDays: disc.cooldownDays,
        });
      }

      res.json({
        ok: true,
        enqueued: enqKeyword + enqDirect,
        claimed: 0,
        upserts: 0,
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
