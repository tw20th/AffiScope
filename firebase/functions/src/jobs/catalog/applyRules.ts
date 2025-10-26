import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import rules from "../../config/catalogRules.json" with { type: "json" };

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type Cond = {
  field: string;
  op: ">=" | "<=" | "==" | ">" | "<";
  value: number | boolean | string | null;
};

function get(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, k) => (acc as any)?.[k], obj as any);
}
function ok(p: Record<string, unknown>, c: Cond): boolean {
  const v = get(p, c.field);
  switch (c.op) {
    case "==": return v === c.value;
    case ">=": return typeof v === "number" && typeof c.value === "number" && v >= c.value;
    case "<=": return typeof v === "number" && typeof c.value === "number" && v <= c.value;
    case ">":  return typeof v === "number" && typeof c.value === "number" && v >  c.value;
    case "<":  return typeof v === "number" && typeof c.value === "number" && v <  c.value;
  }
  return false; // ← 追加
}

export async function applyCatalogRulesOnce(limit = 500) {
  const col = db.collection("catalog").doc("products").collection("items");
  const snap = await col.orderBy("updatedAt", "desc").limit(limit).get();

  let scanned = 0,
    updated = 0;
  for (const d of snap.docs) {
    scanned++;
    const p = d.data() as Record<string, unknown> & {
      tags?: string[];
      category?: string | null;
    };
    const nextTags = new Set(p.tags ?? []);
    let nextCategory = p.category ?? null;

    for (const r of rules as Array<{
      label: string;
      conditions: Cond[];
      tags: string[];
      category: string | null;
    }>) {
      if (r.conditions.every((c) => ok(p, c))) {
        r.tags.forEach((t) => nextTags.add(t));
        if (r.category && !nextCategory) nextCategory = r.category;
      }
    }
    const newTags = Array.from(nextTags);
    const changed =
      newTags.join("|") !== (p.tags ?? []).join("|") ||
      (p.category ?? null) !== nextCategory;
    if (changed) {
      await d.ref.set(
        { tags: newTags, category: nextCategory, updatedAt: Date.now() },
        { merge: true }
      );
      updated++;
    }
  }
  return { scanned, updated };
}
