// firebase/functions/src/scripts/retagProducts.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type Rule =
  | { type: "featureMatches"; pattern: string }
  | { type: "materialMatches"; pattern: string }
  | { type: "titleMatches"; pattern: string }
  | { type: "bestPriceLte"; value: number }
  | { type: "bestPriceGte"; value: number } // 予備
  | { type: "tagWillBe"; tag: string }
  | { type: "all"; all: Rule[] }
  | { type: "or"; any: Rule[] }
  | { type: "any"; any: Rule[] };

type TagRule = { tag: string } & ({ any: Rule[] } | { all: Rule[] });

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function toRe(p: string) {
  return new RegExp(p, "i");
}

function evalRule(
  r: Rule,
  ctx: {
    title: string;
    features: string[];
    material: string;
    bestPrice?: number;
    willTags: Set<string>;
  }
): boolean {
  switch (r.type) {
    case "featureMatches":
      return ctx.features.some((f) => toRe(r.pattern).test(String(f)));
    case "materialMatches":
      return toRe(r.pattern).test(ctx.material);
    case "titleMatches":
      return toRe(r.pattern).test(ctx.title);
    case "bestPriceLte":
      return typeof ctx.bestPrice === "number" && ctx.bestPrice <= r.value;
    case "bestPriceGte":
      return typeof ctx.bestPrice === "number" && ctx.bestPrice >= r.value;
    case "tagWillBe":
      return ctx.willTags.has(r.tag);
    case "all":
      return r.all.every((c) => evalRule(c, ctx));
    case "or":
    case "any":
      return r.any.some((c) => evalRule(c, ctx));
  }
}

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

async function main() {
  const siteId = process.argv[2] || "chairscope";
  const dry = ["1", "true", "yes"].includes(
    String(process.argv[3]).toLowerCase()
  );
  const limit = Number(process.argv[4] || 500);

  const sdoc = await db.collection("sites").doc(siteId).get();
  if (!sdoc.exists) throw new Error(`site not found: ${siteId}`);

  const tagRules: TagRule[] = (sdoc.get("tagRules") || []) as any[];
  if (!Array.isArray(tagRules) || tagRules.length === 0) {
    console.log(`[retag] no tagRules on site=${siteId} (skip)`);
    return;
  }

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
    const title = String(p.title || "");
    const features = arr<string>(p.specs?.features);
    const material = String(p.specs?.material || "");
    const bestPrice =
      typeof p.bestPrice?.price === "number" ? p.bestPrice.price : undefined;

    // まず willTags を空にしてから評価（tagWillBe の参照にも使う）
    const will = new Set<string>();
    const ctxBase = { title, features, material, bestPrice, willTags: will };

    for (const tr of tagRules) {
      const pass =
        "all" in tr
          ? evalRule({ type: "all", all: tr.all }, ctxBase)
          : evalRule({ type: "any", any: tr.any }, ctxBase);
      if (pass) will.add(tr.tag);
    }

    const newTags = Array.from(will);
    const hasChanged =
      JSON.stringify(arr<string>(p.tags).sort()) !==
      JSON.stringify([...newTags].sort());

    if (hasChanged) {
      const set = deepClean({ tags: newTags, updatedAt: now });
      if (dry) {
        console.log(`[DRY][retag] ${d.id}`, { title, newTags });
      } else {
        batch.set(d.ref, set, { merge: true });
      }
      updates++;
    }
  });

  if (!dry && updates) await batch.commit();
  console.log(
    `[retag] site=${siteId} docs=${snap.size} updates=${updates} dryRun=${dry}`
  );
}

main().catch((e) => {
  console.error("[retag] fatal:", e);
  process.exit(1);
});
