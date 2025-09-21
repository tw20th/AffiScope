// apps/web/lib/guards.ts
import type { Product } from "@affiscope/shared-types";

export function assertProduct(x: unknown): asserts x is Product {
  if (typeof x !== "object" || x === null)
    throw new Error("Product is not object");
  const p = x as Record<string, any>;
  if (typeof p.asin !== "string") throw new Error("asin missing");
  if (typeof p.siteId !== "string") throw new Error("siteId missing");
  if (!Array.isArray(p.offers)) throw new Error("offers must be array");
  if (!Array.isArray(p.priceHistory))
    throw new Error("priceHistory must be array");
  if (p.bestPrice && typeof p.bestPrice.price !== "number") {
    throw new Error("bestPrice.price must be number");
  }
}

// 使い方（取得直後）
/*
const items = snap.docs.map(d => {
  const data = d.data();
  assertProduct(data);
  return data;
});
*/
