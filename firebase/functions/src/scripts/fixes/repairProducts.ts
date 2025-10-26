/**
 * firebase/functions/src/scripts/fixes/repairProducts.ts
 *
 * 目的：
 *  - products の欠損フィールド(source/title/createdAt)の軽微なバックフィル
 *  - 価格0/未定義のAmazon商品は ASIN 再取得キューへ
 *  - 価格0/未定義の楽天商品は カテゴリ単位で runUpdateRakuten を叩く（includeKeywords ごと）
 *  - 進捗をわかりやすく集計表示
 *
 * 使い方：
 *   DRY実行（書き込み無し・集計のみ）
 *     pnpm dlx tsx src/scripts/fixes/repairProducts.ts --site all
 *
 *   実行（Firestore更新＆HTTP叩く）
 *     pnpm dlx tsx src/scripts/fixes/repairProducts.ts --site all --apply
 *
 *   siteは  chairscope | powerbank-scope | powerscope | all から選択
 */

import * as admin from "firebase-admin";

// --- 最小限の型（既存モデルに依存せずビルドエラーを避ける） ---
type SiteId = "chairscope" | "powerbank-scope" | "powerscope" | string;

type ProductDoc = {
  siteId?: SiteId;
  categoryId?: string | null;
  title?: string | null;
  source?: "amazon" | "rakuten" | string | null;
  asin?: string | null;
  url?: string | null;
  affiliateUrl?: string | null;
  imageUrl?: string | null;
  bestPrice?: { price?: number | null } | null;
  createdAt?: number | FirebaseFirestore.Timestamp | null;
  updatedAt?: number | FirebaseFirestore.Timestamp | null;
  rakutenExtras?: {
    shopName?: string | null;
  } | null;
};

type AsinQueueDoc = {
  siteId: SiteId;
  asin: string;
  status: "queued" | "processing" | "done" | "failed" | "invalid";
  attempts: number;
  priority: number;
  createdAt: number;
  updatedAt: number;
};

type CategoryDoc = {
  siteId?: SiteId;
  includeKeywords?: unknown;
};

const NOW = Date.now();

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// ===================== CLI =====================
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const siteArgIndex = args.findIndex((a) => a === "--site");
const siteFilter =
  siteArgIndex >= 0 ? (args[siteArgIndex + 1] as SiteId) : ("all" as const);

const TARGET_SITES: SiteId[] =
  siteFilter === "all"
    ? (["chairscope", "powerbank-scope", "powerscope"] as SiteId[])
    : [siteFilter];

console.log(
  `\n=== repairProducts.ts  |  sites=${TARGET_SITES.join(
    ","
  )}  |  APPLY=${APPLY} ===\n`
);

// ===================== Utils =====================

function tsToMillis(
  t?: number | FirebaseFirestore.Timestamp | null
): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  try {
    return t.toMillis();
  } catch {
    return null;
  }
}

function inferSource(p: ProductDoc): "amazon" | "rakuten" | "unknown" {
  const s = (p.source || "").toString().toLowerCase();
  if (s === "amazon" || s === "rakuten") return s as any;
  const u = (p.affiliateUrl || p.url || "").toLowerCase();
  if (u.includes("amazon.co.jp") || u.includes("amzn.to")) return "amazon";
  if (u.includes("rakuten.co.jp") || u.includes("r10s.jp")) return "rakuten";
  return "unknown";
}

/**
 * ASIN 再取得キューを（必要なら）追加。
 * APPLY=true のときのみ書き込み。重複は避ける。
 * 返り値: キューに「入れた or 入れるべきだった」場合 true
 */
async function enqueueAsinIfNeeded(
  p: ProductDoc,
  siteId: SiteId,
  apply: boolean
): Promise<boolean> {
  if (!p.asin) return false;

  const q = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .where("status", "==", "queued")
    .where("asin", "==", p.asin)
    .limit(1)
    .get();

  if (!q.empty) return false;

  if (apply) {
    const payload: AsinQueueDoc = {
      siteId,
      asin: p.asin!,
      status: "queued",
      attempts: 0,
      priority: 50,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await db.collection("asinQueue").add(payload);
  }
  return true;
}

// ===================== 集計 =====================

const counters = {
  scanned: 0,

  backfilledSource: 0,
  backfilledTitle: 0,
  backfilledCreatedAt: 0,

  zeroPriceAmazon: 0,
  zeroPriceRakuten: 0,

  asinQueued: 0, // would or did

  rakutenTriggered: 0, // would or did

  writes: 0,
};

// 楽天のカテゴリ更新をまとめ撃ちするための集合
const rakutenNeeds = new Map<string, { siteId: SiteId; categoryId: string }>();

// ===================== 本体 =====================

async function scanSite(siteId: SiteId) {
  // siteId 単位でページング
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  // ソートは updatedAt desc -> インデックスあり（無い場合は CLI が教えてくれる）
  while (true) {
    let q = db
      .collectionGroup("products")
      .where("siteId", "==", siteId)
      .orderBy("updatedAt", "desc")
      .limit(500);

    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      counters.scanned++;
      const p = doc.data() as ProductDoc;

      const updates: Partial<ProductDoc> = {};

      // --- 軽微バックフィル ---
      // source
      if (!p.source || p.source === "") {
        const guessed = inferSource(p);
        if (guessed !== "unknown") {
          updates.source = guessed;
          counters.backfilledSource++;
        }
      }

      // title（完全欠落の場合は、URL末尾やIDから推測はせず空のまま → 見出しに困るのでIDを仮で入れる）
      if (!p.title) {
        updates.title = doc.id;
        counters.backfilledTitle++;
      }

      // createdAt（無い場合は updatedAt か NOW）
      if (!p.createdAt) {
        const up = tsToMillis(p.updatedAt) ?? NOW;
        updates.createdAt = up;
        counters.backfilledCreatedAt++;
      }

      // 価格0/未定義の扱い
      const price = p?.bestPrice?.price;
      const src = (updates.source as string) || p.source || inferSource(p);

      if (price === 0 || price == null) {
        if (src === "amazon") {
          counters.zeroPriceAmazon++;
          const wouldEnqueue = await enqueueAsinIfNeeded(p, siteId, APPLY);
          if (wouldEnqueue) counters.asinQueued++;
        } else if (src === "rakuten") {
          counters.zeroPriceRakuten++;
          const key = `${siteId}__${p.categoryId || "uncat"}`;
          if (!rakutenNeeds.has(key)) {
            rakutenNeeds.set(key, {
              siteId,
              categoryId: (p.categoryId || "uncat").toString(),
            });
          }
        }
      }

      if (Object.keys(updates).length && APPLY) {
        await doc.ref.set(updates, { merge: true });
        counters.writes++;
      }

      last = doc; // ループ末尾で更新
    }

    // 次ページへ
    if (snap.size < 500) break;
  }
}

async function triggerRakutenUpdates() {
  if (!rakutenNeeds.size) return;

  const BASE = process.env.BASE;
  const ADMIN_SECRET = process.env.ADMIN_SECRET;

  if (!BASE || !ADMIN_SECRET) {
    console.warn(
      "[SKIP] BASE もしくは ADMIN_SECRET が未設定のため runUpdateRakuten は呼びません。"
    );
    return;
  }

  // 対象 siteId ごとに categories を拾って includeKeywords を使う
  const bySite = new Map<
    SiteId,
    Set<string> // categoryId set
  >();

  for (const { siteId, categoryId } of rakutenNeeds.values()) {
    if (!bySite.has(siteId)) bySite.set(siteId, new Set<string>());
    bySite.get(siteId)!.add(categoryId);
  }

  for (const [siteId, categoryIds] of bySite) {
    // categories コレクションを siteId で絞る（全体から siteId== のクエリ）
    const catsSnap = await db
      .collectionGroup("categories")
      .where("siteId", "==", siteId)
      .get();

    // categoryId -> includeKeywords[] を作る
    const kwMap = new Map<string, string[]>();
    for (const c of catsSnap.docs) {
      const cat = c.data() as CategoryDoc;
      const cid = c.id;
      if (!categoryIds.has(cid)) continue;

      const kws = Array.isArray(cat.includeKeywords)
        ? (cat.includeKeywords as unknown[]).map((x) => String(x))
        : [];
      kwMap.set(cid, kws);
    }

    for (const cid of categoryIds) {
      const kws = kwMap.get(cid) || [];
      if (!kws.length) {
        // キーワードがなければ「uncat」のときはスキップ、それ以外は空で1回叩くこともできるが効果薄
        continue;
      }

      for (const keyword of kws) {
        const url = `${BASE}/runUpdateRakuten?siteId=${encodeURIComponent(
          siteId
        )}&categoryId=${encodeURIComponent(cid)}&keyword=${encodeURIComponent(
          keyword
        )}`;
        if (APPLY) {
          try {
            const res = await fetch(url, {
              headers: { "x-admin-secret": ADMIN_SECRET },
            });
            const text = await res.text();
            console.log(
              "[rakuten]",
              siteId,
              cid,
              `"${keyword}"`,
              res.status,
              text.slice(0, 160)
            );
          } catch (e: any) {
            console.warn(
              "[rakuten][ERROR]",
              siteId,
              cid,
              `"${keyword}"`,
              e?.message || e
            );
          }
        } else {
          console.log("[DRY][rakuten]", siteId, cid, `"${keyword}"`);
        }
        counters.rakutenTriggered++;
      }
    }
  }
}

async function main() {
  const started = Date.now();
  for (const site of TARGET_SITES) {
    console.log(`-- scanning site: ${site} --`);
    await scanSite(site);
  }

  // 楽天のまとめ更新
  await triggerRakutenUpdates();

  // 結果
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(counters, null, 2));
  console.log(
    `Rakuten groups: ${rakutenNeeds.size}  | elapsed: ${secs}s  | APPLY=${APPLY}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
