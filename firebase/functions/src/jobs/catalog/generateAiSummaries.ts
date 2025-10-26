import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function yen(n?: number) {
  return typeof n === "number" ? `¥${n.toLocaleString("ja-JP")}` : "";
}
function clip(s: string, max = 150) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function makeSummary(p: any): string {
  const name = String(p.productName || "");
  const tags = (Array.isArray(p.tags) ? p.tags.filter(Boolean) : []).slice(
    0,
    3
  );
  const cap = p?.capacity?.mAh
    ? `${p.capacity.mAh.toLocaleString()}mAh`
    : p?.capacity?.Wh
    ? `${p.capacity.Wh}Wh`
    : "";
  const out = typeof p.outputPower === "number" ? `${p.outputPower}W` : "";
  const wt =
    typeof p.weight === "number"
      ? p.weight >= 1000
        ? `${(p.weight / 1000).toFixed(1)}kg`
        : `${p.weight}g`
      : "";
  const price = yen(p.price);

  const parts: string[] = [];
  parts.push(name);
  const specs = [cap, out, wt].filter(Boolean).join(" / ");
  if (specs) parts.push(`主なスペック: ${specs}`);
  if (price) parts.push(`参考価格: ${price}`);
  if (tags.length) parts.push(`タグ: ${tags.join("・")}`);

  return clip(parts.join("。"));
}

export async function generateCatalogSummariesOnce(limit = 400) {
  const col = db.collection("catalog").doc("products").collection("items");
  const snap = await col
    .where("aiSummary", "in", [null, ""])
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();

  let updated = 0;
  const now = Date.now();
  const batch = db.batch();

  for (const d of snap.docs) {
    const p = d.data();
    const text = makeSummary(p);
    if (text) {
      batch.set(d.ref, { aiSummary: text, updatedAt: now }, { merge: true });
      updated++;
    }
  }
  if (updated) await batch.commit();
  return { scanned: snap.size, updated };
}
