// firebase/functions/src/jobs/seo/generateFromGSC.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import OpenAI from "openai";
import { appendPainCTASection } from "../../lib/content/prompts/blogPrompts.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const REGION = "asia-northeast1";

/* ====== 型 ====== */
type SeoRow = {
  query: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};
type ProductDoc = {
  asin: string;
  siteId: string;
  title?: string;
  productName?: string;
  name?: string;
  brand?: string;
  imageUrl?: string | null;
  categoryId?: string;
  tags?: string[];
  specs?: { features?: string[]; material?: string; dimensions?: any };
  offers?: Array<{
    source: string;
    price: number;
    url: string;
    lastSeenAt: number;
  }>;
  bestPrice?: { price: number; source: string; url: string; updatedAt: number };
  updatedAt?: number;
  createdAt?: number;
};

/* ====== util ====== */
function slugifyKeyword(kw: string) {
  return kw
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
function todayYmd() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}
function scoreRow(r: SeoRow) {
  const imp = +r.impressions! || 0;
  const ctr = +r.ctr! || 0;
  const pos = +r.position! || 0;
  const posBoost = pos > 7 && pos < 16 ? 1.2 : 1.0;
  return imp * (1 - ctr) * posBoost;
}

/* ====== GSC pick ====== */
async function pickGscTargets(
  siteId: string,
  max = 3,
  opts?: { minImp?: number; maxCtr?: number; minPos?: number; maxPos?: number }
): Promise<SeoRow[]> {
  const latest = await db
    .collection("sites")
    .doc(siteId)
    .collection("seo")
    .doc("latest")
    .get();
  const rows = ((latest.data()?.rows as SeoRow[]) || []).filter(Boolean);
  if (!rows.length) return [];
  const { minImp = 50, maxCtr = 0.12, minPos = 5, maxPos = 29 } = opts || {};
  const filtered = rows.filter((r) => {
    const imp = +r.impressions! || 0;
    const ctr = +r.ctr! || 0;
    const pos = +r.position! || 0;
    return imp >= minImp && ctr <= maxCtr && pos >= minPos && pos <= maxPos;
  });
  return filtered.sort((a, b) => scoreRow(b) - scoreRow(a)).slice(0, max);
}

/* ====== OpenAI lazy ====== */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY is not set (runtime).");
  return (_openai ??= new OpenAI({ apiKey: k }));
}

/* ====== products → 比較表（元コードの簡約版） ====== */
function extractSpecs(p: ProductDoc) {
  const text = [p.title, p.productName, p.name, ...(p.specs?.features || [])]
    .filter(Boolean)
    .join(" / ");
  const mAh =
    (text.match(/(\d{4,6})\s*mAh/i)?.[1] ?? "") &&
    `${text.match(/(\d{4,6})\s*mAh/i)![1]}mAh`;
  const watt =
    (text.match(/(\d{2,3})\s*W/i)?.[1] ?? "") &&
    `${text.match(/(\d{2,3})\s*W/i)![1]}W`;
  const weight =
    (text.match(/(\d{2,4})\s*g\b/i)?.[1] ?? "") &&
    `${text.match(/(\d{2,4})\s*g\b/i)![1]}g`;
  const ports =
    text.match(/USB-?C\s*×?\s*(\d)/i)?.[1] ||
    text.match(/([23])\s*ポート/i)?.[1] ||
    "";
  return {
    mAh: mAh || "",
    watt: watt || "",
    weight: weight || "",
    ports: ports || "",
  };
}

function scoreProductForKeyword(p: ProductDoc, keyword: string) {
  const kw = keyword.toLowerCase();
  const hay = [
    p.title,
    p.productName,
    p.name,
    ...(p.tags || []),
    ...(p.specs?.features || []),
  ]
    .filter(Boolean)
    .join(" / ")
    .toLowerCase();
  let s = 0;
  if (hay.includes(kw)) s += 5;
  kw.split(/\s+/)
    .filter(Boolean)
    .forEach((w) => {
      if (hay.includes(w)) s += 2;
    });
  if (p.bestPrice?.price) s += 1;
  if ((p.updatedAt || 0) > Date.now() - 30 * 24 * 3600 * 1000) s += 1;
  if (/モバイルバッテリー|power\s*bank|usb-?c|type-?c|magsafe/i.test(hay))
    s += 1;
  return s;
}

async function getTopProductsForKeyword(
  siteId: string,
  keyword: string,
  limit = 5
) {
  const snap = await db
    .collection("products")
    .where("siteId", "==", siteId)
    .orderBy("updatedAt", "desc")
    .limit(200)
    .get();
  const all: ProductDoc[] = snap.docs.map((d) => d.data() as ProductDoc);
  if (!all.length) return [];
  return all
    .map((p) => ({ p, s: scoreProductForKeyword(p, keyword) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

function buildComparisonTable(products: ProductDoc[]): string {
  if (!products.length) return "";
  const header =
    "| 製品 | 容量 | 最大出力 | ポート | 重量 | 価格 | リンク |\n|---|---:|---:|---|---:|---:|---|\n";
  const rows = products.map((p) => {
    const name = p.title || p.productName || p.name || p.asin;
    const { mAh, watt, weight, ports } = extractSpecs(p);
    const price = p.bestPrice?.price
      ? `${p.bestPrice.price.toLocaleString()}円`
      : "-";
    const link =
      p.bestPrice?.url ||
      p.offers?.[0]?.url ||
      (p.asin ? `https://www.amazon.co.jp/dp/${p.asin}` : "");
    const linkMd = link ? `[Amazon](${link})` : "";
    return `| ${name} | ${mAh} | ${watt} | ${ports} | ${weight} | ${price} | ${linkMd} |`;
  });
  return header + rows.join("\n");
}

function injectComparisonTable(md: string, tableMd: string): string {
  if (!tableMd.trim()) return md;
  const hasSection = /(^|\n)##\s*比較表\s*$/m.test(md);
  if (hasSection) {
    return md.replace(
      /(##\s*比較表\s*\n)([\s\S]*?)(\n##\s|$)/m,
      (_m, h1, _body, tail) => `${h1}\n${tableMd}\n${tail || ""}`
    );
  }
  const firstH2 = md.indexOf("\n## ");
  if (firstH2 > 0)
    return (
      md.slice(0, firstH2) + `\n\n## 比較表\n\n${tableMd}\n` + md.slice(firstH2)
    );
  return `${md.trim()}\n\n## 比較表\n\n${tableMd}\n`;
}

/* ====== プロンプト（既存 buildGscUpdatePrompt を同梱） ====== */
function buildGscUpdatePrompt(params: {
  siteId: string;
  keyword: string;
  existingTitle?: string | null;
  existingMd?: string | null;
}) {
  const { siteId, keyword, existingMd, existingTitle } = params;
  const sys =
    "あなたは日本語のSEO編集者です。指定キーワードの検索意図（購入前の悩み解決・比較検討）に沿って、過剰表現を避け、E-E-A-Tと内部リンク/CTAを意識したMarkdown記事を生成/改稿してください。リンクURLは本文中に既にあるものを優先、無ければAmazonのみ。";
  const base =
    `サイト: ${siteId}\n狙いクエリ: ${keyword}\n出力要件:\n` +
    `- # タイトル（自然にキーワード含有、釣り見出し禁止）\n` +
    `- 導入: 読者の悩み→この記事で分かること→結論(選び方の指針)\n` +
    `- ## 比較表（最低5行｜価格/主要スペック/向いている人）\n` +
    `- ## 選び方の軸（3〜5項目）\n` +
    `- ## おすすめ3選（内部リンク/製品ページへの導線）\n` +
    `- ## FAQ（3問）\n` +
    `- 末尾に「※本ページは広告を含みます」\n`;
  if (existingMd && existingMd.trim().length > 0) {
    const user =
      `【既存タイトル】${existingTitle ?? "(no title)"}\n` +
      `【既存本文（Markdown）】\n${existingMd}\n---\n` +
      base +
      `- 既存本文をベースに、重複/冗長を削り、最新の構成に整えてください。\n` +
      `- URLやショートコード([[pain ...]])は変更しないでください。\n`;
    return { sys, user };
  }
  const user =
    base +
    `- この記事は新規作成です。自然な文体で、箇条書きを活用してください。\n`;
  return { sys, user };
}

/* ====== upsert ====== */
async function upsertBlogByKeyword(siteId: string, keyword: string) {
  const slug = `gsc-${siteId}-${slugifyKeyword(keyword)}-${todayYmd()}`;
  if ((await db.collection("blogs").doc(slug).get()).exists) {
    return { siteId, keyword, slug, created: 0, reason: "already-exists" };
  }
  const prevSnap = await db
    .collection("blogs")
    .where("siteId", "==", siteId)
    .where("targetKeyword", "==", keyword)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  const prev = prevSnap.docs[0];
  const prevData = prev?.data() as
    | { title?: string; content?: string }
    | undefined;

  const { sys, user } = buildGscUpdatePrompt({
    siteId,
    keyword,
    existingTitle: prevData?.title,
    existingMd: prevData?.content,
  });

  const openai = getOpenAI();
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  let md =
    resp.choices[0]?.message?.content?.trim() ??
    `# ${keyword}｜比較・選び方ガイド`;

  const top = await getTopProductsForKeyword(siteId, keyword, 5);
  const table = buildComparisonTable(top);
  if (table) md = injectComparisonTable(md, table);

  const content = await appendPainCTASection(siteId, md);

  const now = Date.now();
  await db
    .collection("blogs")
    .doc(slug)
    .set(
      {
        slug,
        siteId,
        status: "published",
        title: `${keyword}｜比較・選び方ガイド`,
        summary: null,
        content,
        imageUrl: null,
        tags: ["比較", "選び方", "GSC"],
        relatedAsin: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
        views: 0,
        targetKeyword: keyword,
        analysisHistory: [
          {
            updatedAt: now,
            note: prev ? "auto-rewrite-from-gsc" : "auto-create-from-gsc",
          },
        ],
      },
      { merge: false }
    );
  return { siteId, keyword, slug, created: 1, compared: top.length };
}

/* ====== main run for site ====== */
async function fallbackKeyword(siteId: string): Promise<string | null> {
  const sdoc = await db.collection("sites").doc(siteId).get();
  const pools = (sdoc.data()?.keywordPools || {}) as {
    comparison?: string[];
    guide?: string[];
  };
  const pool = [...(pools.comparison || []), ...(pools.guide || [])];
  return pool[0] || null;
}

async function runOnceForSite(
  siteId: string,
  max = 2,
  opts?: { minImp?: number; maxCtr?: number; minPos?: number; maxPos?: number }
) {
  const targets = await pickGscTargets(siteId, max, opts);
  if (!targets.length) {
    const kw = await fallbackKeyword(siteId);
    if (!kw)
      return {
        siteId,
        picked: 0,
        results: [],
        reason: "no-gsc-no-pool" as const,
      };
    const one = await upsertBlogByKeyword(siteId, kw);
    return {
      siteId,
      picked: 1,
      results: [one],
      reason: "fallback-keyword-pool" as const,
    };
  }
  const results: any[] = [];
  for (const r of targets)
    results.push(await upsertBlogByKeyword(siteId, r.query));
  return { siteId, picked: targets.length, results };
}

/* ====== exports ====== */
/** 毎朝 07:30 JST：各サイトのGSC上位クエリから最大2件を自動更新/作成（比較表付き） */
export const generateFromGSC = functions
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .region(REGION)
  .pubsub.schedule("30 7 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const snap = await db
      .collection("sites")
      .where("features.blogs", "==", true)
      .get();
    const siteIds = snap.docs
      .map((d) => (d.data() as { siteId?: string }).siteId!)
      .filter(Boolean) as string[];
    const results = [];
    for (const siteId of siteIds) results.push(await runOnceForSite(siteId, 2));
    return { results };
  });

/** 手動実行（テスト用）: ?siteId=xxx&max=2&relaxed=1 */
export const runGenerateFromGscNow = functions
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      const max = Math.min(Math.max(Number(req.query.max) || 2, 1), 5);
      const relaxed = String(req.query.relaxed || "0") === "1";
      const opts = relaxed
        ? { minImp: 1, maxCtr: 1.0, minPos: 1, maxPos: 100 }
        : undefined;

      if (!siteId) {
        res.status(400).json({ ok: false, error: "siteId is required" });
        return;
      }
      const result = await runOnceForSite(siteId, max, opts);
      res.json({ ok: true, ...result, relaxed });
    } catch (e: any) {
      console.error("[runGenerateFromGscNow] failed", e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
