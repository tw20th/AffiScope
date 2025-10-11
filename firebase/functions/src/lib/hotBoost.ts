// firebase/functions/src/lib/hotBoost.ts
export type HotBoostRule =
  | { type: "seed" }
  | { type: "priceBetween"; min?: number; max?: number }
  | { type: "tagWillBe"; tag: string }
  | { type: "keywordMatches"; pattern: string };

export function shouldBoostHot(params: {
  asin: string;
  seeds?: string[];
  price?: number;
  futureTags?: string[];
  textForMatch?: string;
  rules?: HotBoostRule[];
}): boolean {
  const rules = params.rules || [];
  for (const r of rules) {
    if (r.type === "seed") {
      if (params.seeds?.includes(params.asin)) return true;
    } else if (r.type === "priceBetween") {
      const p = params.price;
      if (typeof p === "number" && isFinite(p)) {
        if ((r.min ?? -Infinity) <= p && p <= (r.max ?? Infinity)) return true;
      }
    } else if (r.type === "tagWillBe") {
      if (params.futureTags?.includes(r.tag)) return true;
    } else if (r.type === "keywordMatches") {
      const s = params.textForMatch || "";
      if (new RegExp(r.pattern, "i").test(s)) return true;
    }
  }
  return false;
}
