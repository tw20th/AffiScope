/**
 * 汎用：サイト設定に書いた tagRules を使って tags を自動付与
 * 使い方:
 *   pnpm -C firebase/functions exec tsx src/scripts/backfillTagsGeneric.ts <siteId> [categoryId]
 * 例:
 *   pnpm -C firebase/functions exec tsx src/scripts/backfillTagsGeneric.ts chairscope gaming-chair
 *   pnpm -C firebase/functions exec tsx src/scripts/backfillTagsGeneric.ts mobapow mobile-battery
 */

try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

// ---------- 型（ゆるめにして何でも受ける） ----------
type Condition =
  | { type: "featureMatches"; pattern: string }
  | { type: "materialMatches"; pattern: string }
  | { type: "titleMatches"; pattern: string }
  | { type: "bestPriceLte"; value: number }
  | { type: "specPathMatches"; path: string; pattern: string } // 例：specs.dimensions.height.value とか
  | { type: "tagWillBe"; tag: string } // 先に確定したタグ依存
  | { type: "all"; all: Condition[] }
  | { type: "any"; any: Condition[] }
  | { type: "or"; any: Condition[] };

type TagRule = { tag: string; any?: Condition[]; all?: Condition[] };

type SiteConfig = {
  siteId: string;
  productRules?: { categoryId?: string };
  tagRules?: TagRule[];
};

// ---------- 安全ユーティリティ ----------
function get(obj: any, path: string): any {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object" || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}
const textHas = (s: unknown, re: RegExp) => typeof s === "string" && re.test(s);
const arrSomeTextHas = (a: unknown, re: RegExp) =>
  Array.isArray(a) && a.some((v) => typeof v === "string" && re.test(v));

function evalCond(c: Condition, p: any, willTags: Set<string>): boolean {
  switch (c.type) {
    case "featureMatches":
      return arrSomeTextHas(
        get(p, "specs.features"),
        new RegExp(c.pattern, "i")
      );
    case "materialMatches":
      return textHas(get(p, "specs.material"), new RegExp(c.pattern, "i"));
    case "titleMatches":
      return textHas(p?.title, new RegExp(c.pattern, "i"));
    case "bestPriceLte": {
      const price = get(p, "bestPrice.price");
      return typeof price === "number" && isFinite(price) && price <= c.value;
    }
    case "specPathMatches":
      return textHas(get(p, c.path), new RegExp(c.pattern, "i"));
    case "tagWillBe":
      return willTags.has(c.tag);
    case "all":
      return (c.all || []).every((cc) => evalCond(cc, p, willTags));
    case "any":
    case "or":
      return (c.any || []).some((cc) => evalCond(cc, p, willTags));
  }
}

// ルール→タグの決定
function computeTagsByRules(p: any, rules: TagRule[]): string[] {
  const decided = new Set<string>();
  // ルール順に「依存関係(tagWillBe)」も解決しながら付与
  for (const r of rules) {
    const okAll = r.all
      ? evalCond({ type: "all", all: r.all }, p, decided)
      : true;
    const okAny = r.any
      ? evalCond({ type: "any", any: r.any }, p, decided)
      : true;
    if (okAll && okAny) decided.add(r.tag);
  }
  return Array.from(decided);
}

function mergeTags(existing: unknown, add: string[]): string[] {
  const base = Array.isArray(existing)
    ? (existing.filter((v) => typeof v === "string") as string[])
    : [];
  const set = new Set<string>([...base, ...add]);
  return Array.from(set);
}

// ---------- main ----------
async function main() {
  const [siteId, categoryId] = process.argv.slice(2).filter(Boolean);
  if (!siteId) {
    console.error(
      "Usage: pnpm -C firebase/functions exec tsx src/scripts/backfillTagsGeneric.ts <siteId> [categoryId]"
    );
    process.exit(1);
  }

  // サイト設定を Firestore から取得（sites/{siteId}）
  const siteSnap = await db.collection("sites").doc(siteId).get();
  if (!siteSnap.exists) {
    console.error(`[site] not found: ${siteId}`);
    process.exit(1);
  }
  const site = siteSnap.data() as SiteConfig;
  const rules = site.tagRules || [];
  if (!rules.length) {
    console.log("[warn] tagRules is empty for site:", siteId);
  }

  console.log("[start] backfill tags generic:", {
    siteId,
    categoryId,
    rules: rules.length,
  });

  // 対象プロダクトのクエリ
  let q = db.collection("products").where("siteId", "==", siteId);
  if (categoryId) q = q.where("categoryId", "==", categoryId);
  const snap = await q.get();
  console.log("[info] total docs:", snap.size);
  if (snap.empty) return;

  const BATCH = 400;
  let batch = db.batch();
  let scanned = 0;
  let updated = 0;

  for (const d of snap.docs) {
    const p = d.data();
    const add = computeTagsByRules(p, rules);
    if (!add.length) {
      scanned++;
      if (scanned % 500 === 0) console.log("[progress] scanned:", scanned);
      continue;
    }
    const merged = mergeTags(p.tags, add);

    const same =
      Array.isArray(p.tags) &&
      p.tags.length === merged.length &&
      p.tags.every((t: any, i: number) => t === merged[i]);

    if (!same) {
      batch.update(d.ref, { tags: merged, updatedAt: Date.now() });
      updated++;
    }

    scanned++;
    if (scanned % BATCH === 0) {
      await batch.commit();
      console.log("[batch] committed:", scanned, "updated:", updated);
      batch = db.batch();
    }
  }

  await batch.commit();
  console.log("[done] scanned:", scanned, "updated:", updated);
}

main().catch((e) => {
  console.error("[error]", e);
  process.exit(1);
});
