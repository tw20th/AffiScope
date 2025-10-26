import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type Pain = "all-day" | "fast-charge" | "ultra-light" | "macbook";

function resolvePains(p: any): Pain[] {
  const out: Pain[] = [];
  const mAh = p?.capacity?.mAh as number | undefined;
  const W = p?.outputPower as number | undefined;
  const wt = p?.weight as number | undefined;
  const tags = new Set<string>(Array.isArray(p?.tags) ? p.tags : []);

  if ((mAh ?? 0) >= 20000) out.push("all-day");
  if ((W ?? 0) >= 30 || tags.has("PD対応")) out.push("fast-charge");
  if ((wt ?? 1e9) <= 200 || tags.has("軽量")) out.push("ultra-light");
  if ((W ?? 0) >= 60) out.push("macbook");

  return Array.from(new Set(out));
}

export async function applyCatalogPainsOnce(limit = 600) {
  const col = db.collection("catalog").doc("products").collection("items");
  const snap = await col.orderBy("updatedAt", "desc").limit(limit).get();

  let scanned = 0,
    updated = 0;
  for (const d of snap.docs) {
    scanned++;
    const p = d.data() as any;
    const pains = resolvePains(p);
    if ((p.pains ?? []).join("|") !== pains.join("|")) {
      await d.ref.set({ pains, updatedAt: Date.now() }, { merge: true });
      updated++;
    }
  }
  return { scanned, updated };
}
