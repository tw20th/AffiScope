// firebase/functions/src/scripts/bootstrapSite.ts
/**
 * サイト初期化ワンショット:
 * 1) sites/<siteId>.json を Firestore へ同期
 * 2) seeds の ASIN をキュー投入 → 取得(upsert)
 * 3) discovery.searchKeywords から検索→ASIN投入 → 取得(upsert)  ※ページ/件数をサイト設定に準拠
 * 4) tagRules を読んで tags を自動付与
 *
 * 使い方:
 *   pnpm -C firebase/functions exec tsx src/scripts/bootstrapSite.ts <siteId> [--limit=25] [--skip-search]
 */

try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { readFileSync } from "fs";
import { resolve, join } from "path";
import { db } from "../lib/db.js";

import { enqueueAsins, discoverForSite } from "../jobs/discoverProducts.js";
import { searchAmazonItems } from "../fetchers/amazon/search.js";

// ---------- utils ----------
type Condition =
  | { type: "featureMatches"; pattern: string }
  | { type: "materialMatches"; pattern: string }
  | { type: "titleMatches"; pattern: string }
  | { type: "bestPriceLte"; value: number }
  | { type: "specPathMatches"; path: string; pattern: string }
  | { type: "tagWillBe"; tag: string }
  | { type: "all"; all: Condition[] }
  | { type: "any"; any: Condition[] }
  | { type: "or"; any: Condition[] };

type TagRule = { tag: string; any?: Condition[]; all?: Condition[] };

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

function computeTagsByRules(p: any, rules: TagRule[]): string[] {
  const decided = new Set<string>();
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

function kwIncludesAny(text: string, kws: string[]): boolean {
  const t = text.toLowerCase();
  return kws.some((k) => t.includes(k.toLowerCase()));
}

function shouldKeepByProductRules(
  title: string | undefined,
  rules: any
): boolean {
  if (!rules) return true;
  const inc: string[] = Array.isArray(rules.includeKeywords)
    ? rules.includeKeywords
    : [];
  const exc: string[] = Array.isArray(rules.excludeKeywords)
    ? rules.excludeKeywords
    : [];
  if (exc.length && title && kwIncludesAny(title, exc)) return false;
  if (inc.length && title && !kwIncludesAny(title, inc)) return false;
  return true;
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const siteId = args.find((a) => !a.startsWith("--"));
  if (!siteId) {
    console.error(
      "Usage: tsx src/scripts/bootstrapSite.ts <siteId> [--limit=25] [--skip-search]"
    );
    process.exit(1);
  }
  const limitArg =
    Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) ||
    25;
  const skipSearch = args.includes("--skip-search");

  // 1) JSON → Firestore(Site)
  const jsonPath = resolve(process.cwd(), "sites", `${siteId}.json`);
  const siteJson = JSON.parse(readFileSync(jsonPath, "utf8"));
  const now = Date.now();
  await db
    .collection("sites")
    .doc(siteId)
    .set(
      {
        ...siteJson,
        siteId,
        updatedAt: now,
        ...(siteJson.createdAt ? {} : { createdAt: now }),
      },
      { merge: true }
    );
  console.log(`[bootstrap] synced sites/${siteId}`);

  // Firestore から最新サイトを取得
  const sdoc = await db.collection("sites").doc(siteId).get();
  if (!sdoc.exists) throw new Error(`site not found after sync: ${siteId}`);
  const site = { id: sdoc.id, ...(sdoc.data() as any) } as any;

  // 2) seeds → enqueue → discover
  const seeds = (site.seeds?.asins as string[]) || [];
  if (seeds.length) {
    await enqueueAsins(siteId, seeds, {
      cooldownDays: site.discovery?.cooldownDays,
    });
    console.log(`[bootstrap] enqueued seeds: ${seeds.length}`);
  }
  await discoverForSite(site, limitArg, {
    relaxed: !!site.discovery?.relaxedOnFirstImport,
  });
  console.log("[bootstrap] discover(seeds/queue) done");

  // 3) keyword 検索 → enqueue → discover（サイト設定を反映）
  if (!skipSearch) {
    const kws = (site.discovery?.searchKeywords as string[]) || [];
    const sIndex = site.discovery?.searchIndex || "OfficeProducts";
    const minP = site.discovery?.minPrice ?? 0;
    const maxP = site.discovery?.maxPrice ?? Number.MAX_SAFE_INTEGER;
    const maxPerRun =
      typeof site.discovery?.maxPerRun === "number" &&
      site.discovery?.maxPerRun > 0
        ? site.discovery.maxPerRun
        : 50;
    const maxPage =
      typeof site.discovery?.maxSearchItemPage === "number" &&
      site.discovery?.maxSearchItemPage > 0
        ? site.discovery.maxSearchItemPage
        : 1;
    const randomize = !!site.discovery?.randomizePage;

    const includeExcludeRules = site.productRules || null;

    const enqueued = new Set<string>(); // ← 総数は size で管理

    for (const kw of kws) {
      if (enqueued.size >= maxPerRun) break;

      // ページ選択
      const pagesToTry = randomize
        ? [Math.floor(Math.random() * maxPage) + 1]
        : Array.from({ length: maxPage }, (_, i) => i + 1);

      for (const page of pagesToTry) {
        if (enqueued.size >= maxPerRun) break;

        const items = await searchAmazonItems(kw, 10, page, {
          sortBy: "Featured",
          searchIndex: sIndex,
        });

        const filtered = items
          .filter((i) => (i.price ?? 0) >= minP && (i.price ?? 0) <= maxP)
          .filter((i) =>
            shouldKeepByProductRules(i.title, includeExcludeRules)
          );

        for (const it of filtered) {
          if (enqueued.size >= maxPerRun) break;
          if (!it.asin) continue;
          enqueued.add(it.asin);
        }
      }
    }

    const asins = Array.from(enqueued);
    await enqueueAsins(siteId, asins, {
      cooldownDays: site.discovery?.cooldownDays,
    });

    await discoverForSite(site, limitArg, {
      relaxed: !!site.discovery?.relaxedOnFirstImport,
    });

    console.log(
      `[bootstrap] search+discover done (enqueued by search: ${asins.length} / maxPerRun=${maxPerRun}, pages<=${maxPage}, randomize=${randomize})`
    );
  }

  // 4) tagRules に基づいて tags 付与
  const rules: TagRule[] = Array.isArray(site.tagRules) ? site.tagRules : [];
  if (!rules.length) {
    console.log("[bootstrap] tagRules empty -> skip tagging");
    return;
  }

  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .get();
  console.log("[bootstrap] tagging total:", snap.size);

  const BATCH = 400;
  let batch = db.batch();
  let scanned = 0,
    updated = 0;

  for (const d of snap.docs) {
    const p = d.data();
    const add = computeTagsByRules(p, rules);
    if (!add.length) {
      scanned++;
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
      batch = db.batch();
    }
  }
  await batch.commit();
  console.log(
    "[bootstrap] tagging done. scanned:",
    scanned,
    "updated:",
    updated
  );
}

main().catch((e) => {
  console.error("[bootstrap] error:", e);
  process.exit(1);
});
