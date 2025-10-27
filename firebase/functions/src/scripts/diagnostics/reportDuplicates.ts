/* eslint-disable no-console */
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import path from "node:path";

// ---- Admin init ----
if (getApps().length === 0) initializeApp();
const db = getFirestore();

// ---- Types ----
type MonitoredItem = {
  productName: string;
  imageUrl?: string;
  asin?: string;
  jan?: string;
  ean?: string;
  // 任意: 型番が既に抽出済みなら使う
  modelNumber?: string;
};

// ---- CLI opts ----
const args = process.argv.slice(2);
function getArg(name: string, fallback?: string): string | undefined {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
const siteId = getArg("site", "chairscope")!;
const limitStr = getArg("limit");
const hardLimit = limitStr ? Math.max(1, Number(limitStr)) : 50000;

// ---- Helpers ----
const NOISE = [
  "送料無料",
  "公式",
  "純正",
  "正規",
  "セール",
  "ポイント",
  "レビュー",
  "限定",
  "ゲーミング",
  "ゲーム",
  "オフィス",
  "チェア",
  "椅子",
  "ショップ",
  "store",
];

function normalizeTitle(t: string): string {
  let s = t.toLowerCase();
  s = s.replace(/[\u3000\s]+/g, " "); // 全角/半角空白を統一
  s = s.replace(/[【】\[\]\(\)（）:,，。\.!！?？~〜・/／\\\|'"`]/g, " ");
  for (const w of NOISE) s = s.replaceAll(w, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function pickModelToken(t: string): string | undefined {
  const cand = t.toUpperCase().match(/[A-Z0-9-]{4,}/g);
  if (!cand) return undefined;
  // ありがちな雑ノイズ（USB, TYPEC など）を少し除外
  const bad = new Set(["USB", "TYPEC", "TYPE-C", "PD", "QC", "LED"]);
  const first = cand.find((c) => !bad.has(c));
  return first;
}

function imageKey(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return path.basename(u.pathname);
  } catch {
    // クエリ付きの素URLなども一応処理
    const clean = url.split("?")[0];
    return clean.split("/").pop();
  }
}

function primaryKey(x: MonitoredItem): string {
  if (x.asin) return `asin:${x.asin}`;
  if (x.jan) return `jan:${x.jan}`;
  if (x.ean) return `ean:${x.ean}`;
  if (x.modelNumber) return `model:${x.modelNumber}`;
  const m = pickModelToken(x.productName);
  if (m) return `model:${m}`;
  const ik = imageKey(x.imageUrl);
  if (ik) return `img:${ik}`;
  return `title:${normalizeTitle(x.productName)}`;
}

function short(s: string, n = 64): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ---- Main ----
async function main() {
  console.log(`Site: ${siteId}`);
  const col = db.collection("sites").doc(siteId).collection("monitoredItems");

  const groups = new Map<string, Array<{ id: string; name: string }>>();
  let scanned = 0;

  let q = col.limit(1000);
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    if (last) q = col.startAfter(last).limit(1000);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const d = doc.data() as MonitoredItem;
      if (!d?.productName) continue;

      const key = primaryKey(d);
      const arr = groups.get(key) ?? [];
      arr.push({ id: doc.id, name: d.productName });
      groups.set(key, arr);

      scanned++;
      if (scanned >= hardLimit) break;
    }
    last = snap.docs[snap.docs.length - 1];
    if (scanned >= hardLimit) break;
  }

  const dupes = [...groups.entries()]
    .filter(([, arr]) => arr.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  console.log("---- RESULT ----");
  console.log(
    JSON.stringify(
      {
        scanned,
        groups: groups.size,
        duplicatesGroups: dupes.length,
        duplicatesItemsTotal: dupes.reduce(
          (acc, [, arr]) => acc + arr.length,
          0
        ),
      },
      null,
      2
    )
  );

  // 上位だけ可読出力
  for (const [key, arr] of dupes.slice(0, 50)) {
    console.log(`\n[${key}] x${arr.length}`);
    for (const it of arr.slice(0, 6)) {
      console.log(`  - ${it.id} :: ${short(it.name)}`);
    }
    if (arr.length > 6) console.log(`  ... +${arr.length - 6} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
