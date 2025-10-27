/* eslint-disable no-console */
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import path from "node:path";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type Offer = {
  price?: number;
  affiliateUrl?: string;
  shopName?: string;
  marketplace?: "rakuten" | "amazon";
  updatedAt?: FirebaseFirestore.Timestamp;
};

type Monitored = {
  productName: string;
  imageUrl?: string;
  imageGallery?: string[];
  price?: number;
  affiliateUrl?: string; // legacy
  affiliateUrls?: { rakuten?: string; amazon?: string };
  asin?: string;
  jan?: string;
  ean?: string;
  modelNumber?: string;
  shopName?: string;
  marketplace?: "rakuten" | "amazon";
  offers?: Offer[];
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
};

const ARGS = process.argv.slice(2);
function arg(name: string, def?: string) {
  const k = `--${name}`;
  const hit = ARGS.find((a) => a === k || a.startsWith(`${k}=`));
  if (!hit) return def;
  return hit.includes("=")
    ? hit.split("=")[1]
    : ARGS[ARGS.indexOf(hit) + 1] ?? def;
}

const SITE = arg("site", "chairscope")!;
const APPLY = ARGS.includes("--apply") || arg("apply") === "true";
const DRY = !APPLY; // デフォルトDRY
const LIMIT = Number(arg("limit", "200000"));

const BAD_TOKENS = new Set(["USB", "TYPEC", "TYPE-C", "PD", "QC", "LED"]);
function modelFromName(name: string): string | undefined {
  const cand = name?.toUpperCase().match(/[A-Z0-9-]{4,}/g);
  if (!cand) return;
  return cand.find((c) => !BAD_TOKENS.has(c));
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
function primaryKey(x: Monitored): string {
  if (x.asin) return `asin:${x.asin}`;
  if (x.jan) return `jan:${x.jan}`;
  if (x.ean) return `ean:${x.ean}`;
  if (x.modelNumber) return `model:${x.modelNumber}`;
  const m = modelFromName(x.productName);
  if (m) return `model:${m}`;
  const ik = imageKey(x.imageUrl);
  if (ik) return `img:${ik}`;
  return `title:${x.productName
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120)}`;
}

function pickBestImage(imgs: string[]): string | undefined {
  return imgs.sort((a, b) => b.length - a.length)[0];
}
function scoreDoc(d: Monitored): number {
  let s = 0;
  if (d.price != null) s += 3;
  if (d.imageUrl) s += 2;
  if (d.affiliateUrl || d.affiliateUrls) s += 2;
  if (d.asin || d.jan || d.ean || d.modelNumber) s += 2;
  if (d.offers?.length) s += Math.min(3, d.offers.length);
  if (d.createdAt) s += 1;
  if (d.updatedAt) s += 1;
  return s;
}

// --- 重要：undefined を除去するユーティリティ（ネスト & 配列対応 / ts-comment不要）
function compact<T>(value: T): T {
  // 配列
  if (Array.isArray(value)) {
    const cleaned = (value as unknown[])
      .map((v) => compact(v))
      .filter((v) => v !== undefined);
    return cleaned as unknown as T;
  }

  // プレーンオブジェクト
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined) continue;
      out[k] = compact(v);
    }
    return out as unknown as T;
  }

  // プリミティブ
  return value;
}

async function main() {
  console.log(`Site: ${SITE}  mode: ${DRY ? "DRY-RUN" : "APPLY"}`);
  const col = db.collection("sites").doc(SITE).collection("monitoredItems");

  const groups = new Map<string, Array<{ id: string; data: Monitored }>>();
  let scanned = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    const q = last ? col.startAfter(last).limit(1000) : col.limit(1000);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data() as Monitored;
      if (!data?.productName) continue;
      const key = primaryKey(data);
      const arr = groups.get(key) ?? [];
      arr.push({ id: doc.id, data });
      groups.set(key, arr);
      scanned++;
      if (scanned >= LIMIT) break;
    }
    last = snap.docs[snap.docs.length - 1];
    if (scanned >= LIMIT) break;
  }

  const dupes = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  console.log(
    JSON.stringify(
      {
        scanned,
        groups: groups.size,
        duplicateGroups: dupes.length,
        duplicateItems: dupes.reduce((a, [, arr]) => a + arr.length, 0),
      },
      null,
      2
    )
  );

  let writes = 0;

  for (const [key, arr] of dupes) {
    const sorted = arr
      .slice()
      .sort(
        (a, b) =>
          scoreDoc(b.data) - scoreDoc(a.data) ||
          (a.data.price ?? Infinity) - (b.data.price ?? Infinity)
      );

    const canonical = sorted[0];
    const rest = sorted.slice(1);

    // offers 統合
    const gallery = new Set<string>();
    const offers: Offer[] = [];

    // 代表＋残りから画像とオファーを吸い上げ
    const all = [canonical, ...rest];
    for (const x of all) {
      if (x.data.imageUrl) gallery.add(x.data.imageUrl);
      const off: Offer = {
        price: x.data.price,
        affiliateUrl:
          x.data.affiliateUrl ??
          x.data.affiliateUrls?.rakuten ??
          x.data.affiliateUrls?.amazon,
        shopName: x.data.shopName,
        marketplace: x.data.marketplace,
        updatedAt: x.data.updatedAt ?? Timestamp.now(),
      };
      // 価格かURLがひとつでもあれば採用
      if (off.price != null || off.affiliateUrl) offers.push(compact(off));
      // 既存offersがあれば追加
      if (x.data.offers?.length) {
        for (const o of x.data.offers) {
          offers.push(compact(o));
        }
      }
    }

    // 最安値
    const minPrice = offers
      .map((o) => o.price)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b)[0];

    const imageUrl = pickBestImage([...gallery]);

    // affiliateUrls（undefinedのキーは落とす）
    const aff: Record<string, string> = {};
    const candRakuten =
      canonical.data.affiliateUrls?.rakuten ??
      (canonical.data.marketplace === "rakuten"
        ? canonical.data.affiliateUrl
        : undefined);
    const candAmazon =
      canonical.data.affiliateUrls?.amazon ??
      (canonical.data.marketplace === "amazon"
        ? canonical.data.affiliateUrl
        : undefined);
    if (candRakuten) aff.rakuten = candRakuten;
    if (candAmazon) aff.amazon = candAmazon;

    // --- DRY の場合は書き込みしない
    if (DRY) {
      console.log(
        `[DRY] ${key} -> keep ${canonical.id}, merge ${rest.length} (offers=${
          offers.length
        }, min=${minPrice}, img=${imageUrl ? "yes" : "no"})`
      );
      continue;
    }

    // --- APPLY: バッチ更新（undefined排除のために compact + 条件付き展開）
    const canonicalRef = col.doc(canonical.id);
    const batch = db.batch();

    const updatePayload: Record<string, unknown> = compact({
      offers, // すでに要素内はcompact済み
      price: minPrice ?? canonical.data.price ?? null,
      imageUrl: imageUrl ?? canonical.data.imageUrl ?? null,
      imageGallery: [...gallery],
      updatedAt: Timestamp.now(),
    });

    // affiliateUrls はキーが無ければ削除、あれば更新
    if (Object.keys(aff).length > 0) {
      updatePayload.affiliateUrls = aff;
    } else {
      updatePayload.affiliateUrls = FieldValue.delete();
    }

    batch.update(canonicalRef, updatePayload);

    for (const x of rest) batch.delete(col.doc(x.id));

    await batch.commit();
    writes += 1 + rest.length;
    console.log(
      `[APPLY] ${key} merged -> ${canonical.id}  (+${rest.length} removed)`
    );
  }

  console.log(`done. writes=${writes} (mode=${DRY ? "dry" : "apply"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
