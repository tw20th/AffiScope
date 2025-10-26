import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function yen(n?: number) {
  return typeof n === "number" ? `¥${n.toLocaleString("ja-JP")}` : "";
}
function truncate(s: string, max = 140) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function makeSummary(p: any): string {
  const brand = p.brand ? String(p.brand) + " " : "";
  const title = String(p.title || p.asin || "");
  const price = yen(p.bestPrice?.price);
  const tags = uniq(
    (Array.isArray(p.tags) ? p.tags : []).filter(Boolean)
  ).slice(0, 3);
  const feats = Array.isArray(p.specs?.features)
    ? p.specs.features.slice(0, 2)
    : [];

  const parts: string[] = [];
  parts.push(`${brand}${title}`);
  if (feats.length) parts.push(`主な特徴: ${feats.join(" / ")}`);
  if (price) parts.push(`参考価格: ${price}`);
  if (tags.length) parts.push(`タグ: ${tags.join("・")}`);

  return truncate(parts.join("。"));
}

function deepClean<T>(v: T): T {
  if (Array.isArray(v))
    return v.map(deepClean).filter((x) => x !== undefined) as any;
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

async function main() {
  const siteId = process.argv[2] || "chairscope";
  const dry = ["1", "true", "yes"].includes(
    String(process.argv[3]).toLowerCase()
  );
  const limit = Number(process.argv[4] || 500);

  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .limit(Math.max(1, limit))
    .get();

  const batch = db.batch();
  const now = Date.now();
  let updates = 0;

  snap.forEach((d) => {
    const p = d.data() as any;
    const current = String(p.aiSummary || "");
    const next = makeSummary(p);
    if (current !== next) {
      const set = deepClean({ aiSummary: next, updatedAt: now });
      if (dry) {
        console.log(`[DRY][summary] ${d.id}`, next);
      } else {
        batch.set(d.ref, set, { merge: true });
      }
      updates++;
    }
  });

  if (!dry && updates) await batch.commit();
  console.log(
    `[summary] site=${siteId} docs=${snap.size} updates=${updates} dryRun=${dry}`
  );
}

main().catch((e) => {
  console.error("[summary] fatal:", e);
  process.exit(1);
});
