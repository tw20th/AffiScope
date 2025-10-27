// firebase/functions/src/jobs/products/scheduledRakutenIngest.ts
import { createHash } from "node:crypto";
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { searchItems } from "../../services/rakuten/client.js";
import { mapRakutenToRaw } from "../../services/rakuten/mapRakutenToRaw.js";
import { shouldKeepRakutenItem } from "../../lib/products/rakutenFilters.js";
import path from "node:path";

function modelFromName(name: string): string | undefined {
  const cand = name?.toUpperCase().match(/[A-Z0-9-]{4,}/g);
  if (!cand) return;
  const BAD = new Set(["USB", "TYPEC", "TYPE-C", "PD", "QC", "LED"]);
  return cand.find((c) => !BAD.has(c));
}

function imageKey(url?: string): string | undefined {
  if (!url) return;
  try {
    const u = new URL(url);
    return path.basename(u.pathname);
  } catch {
    const clean = url.split("?")[0];
    return clean.split("/").pop();
  }
}

function buildDedupeKey(src: {
  productName: string;
  imageUrl?: string;
  jan?: string;
  ean?: string;
  modelNumber?: string;
  asin?: string;
}) {
  if (src.asin) return `asin:${src.asin}`;
  if (src.jan) return `jan:${src.jan}`;
  if (src.ean) return `ean:${src.ean}`;
  if (src.modelNumber) return `model:${src.modelNumber}`;
  const m = modelFromName(src.productName);
  if (m) return `model:${m}`;
  const ik = imageKey(src.imageUrl);
  if (ik) return `img:${ik}`;
  const norm = src.productName
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return `title:${norm}`;
}

function priceOfRakuten(it: any): number {
  const n = Number(it?.itemPrice);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}
const REGION = "asia-northeast1";

// Secret Manager: 既に登録済みのものを使用
const RAKUTEN_APP_ID = defineSecret("RAKUTEN_APP_ID");
const RAKUTEN_AFFILIATE_ID = defineSecret("RAKUTEN_AFFILIATE_ID");
const ADMIN_TASK_SECRET = defineSecret("ADMIN_TASK_SECRET");

// スロットリング（1req/sec以上にしない）
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Firestore の sites/{siteId} から読むフィールド名
type SiteConfigDoc = {
  rakutenKeywords?: string[];
  rakutenCategoryMap?: { [keyword: string]: string }; // 任意：キーワード→categoryId の個別指定
  defaultCategoryId?: string; // categoryId 未指定時のデフォルト
};

// ローテーション用の進捗を ops/rakuten_ingest_state に保存
type RotorDoc = {
  indexBySite?: { [siteId: string]: number }; // 次に処理する Keyword のインデックス
  lastRunAt?: number;
};

async function loadSitesList(): Promise<string[]> {
  const db = getFirestore();
  const snap = await db.collection("sites").select().get();
  return snap.docs.map((d) => d.id).sort();
}

async function loadSiteConfig(siteId: string): Promise<SiteConfigDoc> {
  const db = getFirestore();
  const doc = await db.collection("sites").doc(siteId).get();
  const data = (doc.exists ? (doc.data() as any) : {}) || {};
  const out: SiteConfigDoc = {
    rakutenKeywords: Array.isArray(data.rakutenKeywords)
      ? data.rakutenKeywords.filter(
          (s: any) => typeof s === "string" && s.trim()
        )
      : undefined,
    rakutenCategoryMap:
      data.rakutenCategoryMap && typeof data.rakutenCategoryMap === "object"
        ? data.rakutenCategoryMap
        : undefined,
    defaultCategoryId:
      typeof data.defaultCategoryId === "string"
        ? data.defaultCategoryId
        : undefined,
  };
  return out;
}

async function loadRotor(): Promise<RotorDoc> {
  const db = getFirestore();
  const ref = db.collection("ops").doc("rakuten_ingest_state");
  const doc = await ref.get();
  return (doc.exists ? (doc.data() as RotorDoc) : {}) || {};
}

async function saveRotor(rotor: RotorDoc) {
  const db = getFirestore();
  const ref = db.collection("ops").doc("rakuten_ingest_state");
  await ref.set({ ...rotor, lastRunAt: Date.now() }, { merge: true });
}

/**
 * 1回の実行で、各サイトから「keywordsPerSite 個 × pagesPerKeyword ページ」を処理。
 * 直列＋1.2秒待機で 1req/sec を遵守。
 */
// ① 受け口を追加
async function processOnce(params: {
  hits: number;
  pagesPerKeyword: number;
  delayMs: number;
  keywordsPerSite: number;
  skipFilter?: boolean; // 追加 ← フィルタ無効化（デバッグ用）
}) {
  const { hits, pagesPerKeyword, delayMs, keywordsPerSite, skipFilter } =
    params;

  const db = getFirestore();
  const sites = await loadSitesList();
  const rotor = await loadRotor();
  rotor.indexBySite = rotor.indexBySite || {};

  for (const siteId of sites) {
    const cfg = await loadSiteConfig(siteId);
    const keywords = cfg.rakutenKeywords || [];
    if (keywords.length === 0) {
      console.log(`[rakuten][${siteId}] no keywords -> skip`);
      continue;
    }

    const start = rotor.indexBySite![siteId] || 0;
    const tasks: { keyword: string; categoryId: string }[] = [];

    for (let i = 0; i < keywordsPerSite; i++) {
      const idx = (start + i) % keywords.length;
      const kw = keywords[idx];
      const categoryId =
        (cfg.rakutenCategoryMap && cfg.rakutenCategoryMap[kw]) ||
        cfg.defaultCategoryId ||
        "default";
      tasks.push({ keyword: kw, categoryId });
    }

    rotor.indexBySite![siteId] = (start + keywordsPerSite) % keywords.length;

    const col = db.collection("raw").doc("rakuten").collection("items");

    for (const { keyword, categoryId: _categoryId } of tasks) {
      for (let page = 1; page <= pagesPerKeyword; page++) {
        try {
          const { items } = await searchItems({
            keyword,
            hits: Math.max(1, Math.min(30, hits)),
            page,
            sort: "+itemPrice",
          });

          const got = Array.isArray(items) ? items.length : 0;
          console.log(
            `[rakuten][${siteId}] "${keyword}" p${page}/${pagesPerKeyword} -> fetched=${got}`
          );

          if (!items || items.length === 0) break;

          const filtered: any[] = [];
          for (const it of items) {
            const keep = skipFilter
              ? true
              : await shouldKeepRakutenItem({
                  siteId,
                  title: String(it?.itemName || ""),
                });
            if (keep) filtered.push(it);
          }

          // 同一 dedupeKey の中で最安のみ採用
          const byKey = new Map<string, any>();
          for (const it of filtered) {
            const src = {
              productName: String(it?.itemName || ""),
              imageUrl: it?.mediumImageUrls?.[0]?.imageUrl || it?.imageUrl,
              // 楽天のレスポンスに JAN/型番/ASIN があれば入れてOK（無ければ未使用で可）
              // jan: it?.jan, ean: it?.ean, modelNumber: it?.modelNumber, asin: it?.asin,
            };
            const key = buildDedupeKey(src);
            const cur = byKey.get(key);
            if (!cur || priceOfRakuten(it) < priceOfRakuten(cur))
              byKey.set(key, it);
          }
          const deduped = [...byKey.values()];

          if (deduped.length === 0) {
            if (page < pagesPerKeyword) await sleep(Math.max(1000, delayMs));
            continue;
          }

          const batch = db.batch();
          const now = Date.now();

          for (const it of deduped) {
            const rawDoc = mapRakutenToRaw(siteId, it, now);
            const docId =
              typeof it?.itemCode === "string" && it.itemCode
                ? String(it.itemCode)
                : createHash("sha1")
                    .update(String(it?.itemUrl ?? ""))
                    .digest("hex");

            batch.set(col.doc(docId), rawDoc, { merge: true });
          }
          await batch.commit();
          console.log(
            `[rakuten][${siteId}] "${keyword}" p${page} wrote=${deduped.length} (deduped from ${filtered.length})`
          );

          if (page < pagesPerKeyword) await sleep(Math.max(1000, delayMs));
        } catch (e: any) {
          console.error(
            `[rakuten][${siteId}] "${keyword}" p${page} ERROR:`,
            e?.message || e
          );
          if (page < pagesPerKeyword) await sleep(Math.max(1000, delayMs));
        }
      }
    }
  }

  await saveRotor(rotor);
}

/** 毎時スケジュール（東京TZ）。1サイト = 1キーワード×3ページを直列処理。 */
export const scheduledRakutenIngest = functions
  .region(REGION)
  .runWith({
    secrets: [RAKUTEN_APP_ID, RAKUTEN_AFFILIATE_ID],
    timeoutSeconds: 540, // 9分まで余裕
    memory: "256MB",
  })
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    await processOnce({
      hits: 30,
      pagesPerKeyword: 3,
      delayMs: 1200,
      keywordsPerSite: 1,
    });
  });

/** 手動トリガー（管理者のみ）。パラメータで上書き可能。 */
export const runRakutenIngestNow = functions
  .region(REGION)
  .runWith({
    secrets: [RAKUTEN_APP_ID, RAKUTEN_AFFILIATE_ID, ADMIN_TASK_SECRET],
    timeoutSeconds: 540,
    memory: "256MB",
  })
  .https.onRequest(async (req, res) => {
    const adminSecret = ADMIN_TASK_SECRET.value();
    const provided =
      (req.headers["x-admin-secret"] as string) ||
      (req.headers["x-admin-key"] as string) ||
      (req.query.secret as string);
    if (!adminSecret || provided !== adminSecret) {
      res.status(403).json({ error: "unauthorized" });
      return;
    }

    const hits = Number(req.query.hits ?? 30);
    const pagesPerKeyword = Number(req.query.pagesPerKeyword ?? 3);
    const delayMs = Number(req.query.delayMs ?? 1200);
    const keywordsPerSite = Number(req.query.keywordsPerSite ?? 1);
    const skipFilter = String(req.query.noFilter || "0") === "1"; // ← 追加

    await processOnce({
      hits: Math.max(1, Math.min(30, hits)),
      pagesPerKeyword: Math.max(1, Math.min(100, pagesPerKeyword)),
      delayMs: Math.max(1000, delayMs),
      keywordsPerSite: Math.max(1, keywordsPerSite),
      skipFilter,
    });

    res.json({ ok: true });
  });
