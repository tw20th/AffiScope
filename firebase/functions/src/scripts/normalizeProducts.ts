// firebase/functions/src/scripts/normalizeProducts.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getSiteConfig } from "../lib/siteConfig.js";
import { getPaapiOptionsFromSite } from "../lib/paapiOpts.js";
import { getItemsOnce, type OfferHit } from "../services/paapi/client.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const GPU_PATTERNS =
  /(gpu|グラボ|グラフィック|rtx|geforce|pcie|gddr|displayport)/i;
const CHAIR_PATTERNS = /(チェア|椅子|chair)/i;

type Opts = {
  siteId: string;
  dryRun?: boolean;
  limit?: number;
  noRefetch?: boolean;
};

function short(s?: string) {
  if (!s) return "";
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}
function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// --- 重要：ネストを含めて undefined を完全に除去 ---
function deepClean<T>(v: T): T {
  if (Array.isArray(v)) {
    return v.map(deepClean).filter((x) => x !== undefined) as any;
  }
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v as any)) {
      const cleaned = deepClean(val);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out as any;
  }
  return v as any;
}

async function main({
  siteId,
  dryRun = false,
  limit = 500,
  noRefetch = false,
}: Opts) {
  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .limit(limit)
    .get();

  const asinsToRefetch: string[] = [];
  const fixes: Array<{ id: string; update?: Record<string, unknown> }> = [];

  snap.forEach((d) => {
    const p = d.data() as any;
    const title: string = p.title || "";
    const cat: string = p.categoryId || "";

    // 1) カテゴリ正規化（GPU混入 → gpu）
    if (
      cat === "gaming-chair" &&
      GPU_PATTERNS.test(title) &&
      !CHAIR_PATTERNS.test(title)
    ) {
      fixes.push({
        id: d.id,
        update: { categoryId: "gpu", updatedAt: Date.now() },
      });
    }

    // 2) バックフィル対象判定
    const needBrand = !isStr(p.brand);
    const needImage = !isStr(p.imageUrl);
    const needSpecs =
      !p.specs ||
      (!isStr(p.specs?.material) &&
        (!Array.isArray(p.specs?.features) || p.specs.features.length === 0) &&
        !p.specs?.dimensions);
    const needTrust = !p.trust;

    if (!noRefetch && (needBrand || needImage || needSpecs || needTrust)) {
      const asin = p.asin as string | undefined;
      if (isStr(asin)) asinsToRefetch.push(asin);
    }
  });

  console.log(
    `[normalize] products=${snap.size} refetch=${asinsToRefetch.length} fixes=${fixes.length} noRefetch=${noRefetch}`
  );

  // 3) 必要なら PA-API を使用（新クライアント）
  let offers: Record<string, OfferHit> = {};
  if (!noRefetch && asinsToRefetch.length) {
    try {
      const siteCfg = await getSiteConfig(siteId);
      const paapiCfg = getPaapiOptionsFromSite(siteCfg || {});
      offers = await getItemsOnce(asinsToRefetch, paapiCfg);
    } catch (e) {
      console.warn("[normalize] getItemsOnce skipped due to error:", e);
      offers = {};
    }
  }

  const batch = db.batch();
  const now = Date.now();

  snap.forEach((d) => {
    const p = d.data() as any;
    const asin = p.asin as string | undefined;
    const set: Record<string, any> = {};

    // カテゴリfix
    const fix = fixes.find((f) => f.id === d.id);
    if (fix?.update) Object.assign(set, fix.update);

    // バックフィル（of が無くても “器” は確保）
    const of = asin ? offers[asin] : null;

    // brand / image
    if (!isStr(p.brand) && isStr(of?.brand)) set.brand = of.brand;
    if (!isStr(p.imageUrl) && isStr(of?.imageUrl)) set.imageUrl = of.imageUrl;

    // specs の器（undefined は除去）
    const specs = {
      dimensions: of?.dimensions ?? p.specs?.dimensions ?? undefined,
      material: of?.material ?? p.specs?.material ?? "",
      features:
        (Array.isArray(of?.features) && of.features.length
          ? of.features
          : undefined) ??
        (Array.isArray(p.specs?.features) ? p.specs.features : []) ??
        [],
    };
    set.specs = specs;

    // trust（任意）
    const trust: Record<string, unknown> = {};
    if (of?.merchant) trust.merchant = of.merchant;
    if (of?.offerCount !== undefined) trust.offerCount = of.offerCount;
    if ((of as any)?.warranty) trust.warranty = (of as any).warranty; // 型に無くても安全に扱う
    if (Object.keys(trust).length) set.trust = trust;

    if (Object.keys(set).length) {
      set.updatedAt = now;
      const cleaned = deepClean(set); // ← ここで undefined を全除去！
      if (dryRun) {
        console.log(`[DRY] ${d.id}`, short(p.title), cleaned);
      } else {
        batch.set(d.ref, cleaned, { merge: true });
      }
    }
  });

  if (!dryRun) await batch.commit();
  console.log(`[normalize] done site=${siteId} dryRun=${dryRun}`);
}

// CLI
const siteId = process.argv[2] || "chairscope";
const dry = ["1", "true", "yes"].includes(
  String(process.argv[3]).toLowerCase()
);
const arg4 = String(process.argv[4] || "").toLowerCase();
const noRefetch =
  arg4 === "no-refetch" ||
  ["1", "true", "yes"].includes(
    String(process.env.NO_REFETCH || "").toLowerCase()
  );

main({ siteId, dryRun: dry, limit: 500, noRefetch }).catch((e) => {
  console.error("[normalize] fatal:", e);
  process.exit(1);
});
