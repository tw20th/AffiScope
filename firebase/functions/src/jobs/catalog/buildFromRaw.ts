import { createHash } from "node:crypto";
import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const REGION = "asia-northeast1";
const ADMIN_TASK_SECRET = defineSecret("ADMIN_TASK_SECRET");

/* -------------------- 小物ユーティリティ -------------------- */
const pickString = (...cands: unknown[]): string | null => {
  for (const c of cands) {
    if (typeof c === "string") {
      const s = c.trim();
      if (s) return s;
    }
  }
  return null;
};

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.replace(/[,\s]/g, "");
    // 例: "10,000mAh" / "200W" / "1.2kg"
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// 再帰的に undefined を除去（NaN は null に変換）
const deepClean = (v: any): any => {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "object") return v;

  if (Array.isArray(v)) {
    const a = v.map(deepClean).filter((x) => x !== null);
    return a;
  }

  const o: Record<string, any> = {};
  for (const [k, val] of Object.entries(v)) {
    const cleaned = deepClean(val);
    if (cleaned !== null) o[k] = cleaned;
  }
  return Object.keys(o).length ? o : null;
};

// capacity / outputPower / weight を “未定義キーなし” で正規化
const normalizeCapacity = (raw: any): any => {
  if (raw == null) return null;
  // 形： { mAh?, Wh? } / 数値 / 文字列
  if (typeof raw === "object") {
    const out: any = {};
    const mah = toNumber(raw.mAh ?? raw.mah ?? raw.MAh);
    const wh = toNumber(raw.Wh ?? raw.wh ?? raw.WH);
    if (mah !== null) out.mAh = mah;
    if (wh !== null) out.Wh = wh;
    return Object.keys(out).length ? out : null;
  }
  const n = toNumber(raw);
  if (n !== null) return { mAh: n };
  return null;
};

const normalizeOutputPower = (raw: any): number | null => toNumber(raw);
const normalizeWeight = (raw: any): number | null => {
  // 例: "1.2kg" => 1200(g) にするか、そのまま数値にするかは設計次第
  // ここでは与えられた単位に依存せず数値抽出のみ
  return toNumber(raw);
};

/* -------------------- raw ⇒ catalog の最小マッピング -------------------- */
function toCatalogDoc(raw: any) {
  const siteId: string = raw.siteId ?? "";

  const url = pickString(raw.affiliateUrl, raw.itemUrl, raw.url) ?? "";

  const itemCode: string | undefined =
    pickString(raw.itemCode, raw.sourceId) ?? undefined;

  const id =
    itemCode ||
    createHash("sha1")
      .update(url || pickString(raw.title, raw.itemName, raw.productName) || "")
      .digest("hex");

  const title =
    pickString(raw.productName, raw.title, raw.itemName) || "(no title)";

  const price: number | null = toNumber(
    raw.price ?? raw.itemPrice ?? raw.minPrice
  );

  const imageUrl: string | null =
    pickString(
      raw.imageUrl,
      raw.mediumImageUrl,
      Array.isArray(raw.mediumImageUrls)
        ? raw.mediumImageUrls[0]?.imageUrl
        : null,
      raw.smallImageUrl
    ) || null;

  const category: string | null =
    pickString(raw.categoryId, raw.category, raw.defaultCategoryId) || null;

  const offer = deepClean({
    source: "rakuten",
    shopName: pickString(raw.shopName, raw.shop) || null,
    price,
    url: url || null,
    updatedAt: Date.now(),
  });

  // “強化”で埋まるフィールドは空・安全な形で置いておく
  const specs = deepClean(raw.specs ?? {});
  const tags = Array.isArray(raw.tags)
    ? (raw.tags.filter(
        (t: any) => typeof t === "string" && t.trim()
      ) as string[])
    : [];

  const capacity = normalizeCapacity(raw.capacity);
  const outputPower = normalizeOutputPower(raw.outputPower);
  const weight = normalizeWeight(raw.weight);

  const payload = deepClean({
    siteId,
    productName: title,
    imageUrl,
    price,
    affiliateUrl: url || null,
    offers: offer ? [offer] : [],
    category,

    specs,
    tags,
    aiSummary: typeof raw.aiSummary === "string" ? raw.aiSummary : "",

    updatedAt: Date.now(),
    createdAt: FieldValue.serverTimestamp(),

    source: "rakuten",
    sourceId: itemCode || null,

    hasTypeC: !!raw.hasTypeC,
    capacity,
    outputPower,
    weight,
  });

  return {
    __docId: `${siteId}_${id}`,
    payload, // ← ここを set() 前に使う
  };
}

/* -------------------- 取り込み本体 -------------------- */
async function buildOnce(limit = 1000) {
  const rawCol = db.collection("raw").doc("rakuten").collection("items");
  const snap = await rawCol.orderBy("updatedAt", "desc").limit(limit).get();
  if (snap.empty) return { scanned: 0, written: 0 };

  const batch = db.batch();
  let written = 0;

  snap.forEach((doc) => {
    const cat = toCatalogDoc(doc.data());
    const ref = db
      .collection("catalog")
      .doc("products")
      .collection("items")
      .doc(cat.__docId);

    batch.set(ref, cat.payload, { merge: true });
    written++;
  });

  if (written) await batch.commit();
  return { scanned: snap.size, written };
}

/* -------------------- エクスポート -------------------- */
export const runBuildCatalog = functions
  .region(REGION)
  .runWith({ secrets: [ADMIN_TASK_SECRET] })
  .https.onRequest(async (req, res) => {
    const provided =
      (req.get("x-admin-secret") as string) ||
      (req.get("x-admin-key") as string) ||
      (req.query.secret as string) ||
      "";
    if (!ADMIN_TASK_SECRET.value() || provided !== ADMIN_TASK_SECRET.value()) {
      res.status(403).json({ ok: false, error: "unauthorized" });
      return;
    }
    const limit = Math.min(Number(req.query.limit ?? 1200) || 1200, 3000);
    const out = await buildOnce(limit);
    res.json({ ok: true, ...out });
  });

export const scheduledBuildCatalog = functions
  .region(REGION)
  .pubsub.schedule("every 60 minutes")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const out = await buildOnce(1200);
    console.log("[buildCatalog]", out);
    return out;
  });
