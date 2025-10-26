import type { CatalogProduct, Offer, PricePoint } from "./types.js";

function offerKey(o: Offer): string {
  return `${o.source}:${o.itemCode ?? ""}:${o.shopName ?? ""}`.toLowerCase();
}

export function mergeCatalog(
  existing: CatalogProduct,
  incoming: CatalogProduct,
  now: number
): CatalogProduct {
  // offers マージ
  const map = new Map<string, Offer>();
  for (const o of existing.offers) map.set(offerKey(o), o);
  for (const o of incoming.offers) {
    const k = offerKey(o);
    const prev = map.get(k);
    if (!prev) map.set(k, o);
    else {
      map.set(k, {
        ...prev,
        price: typeof o.price === "number" ? o.price : prev.price,
        url: prev.url ?? o.url,
        lastSeenTs: Math.max(prev.lastSeenTs, o.lastSeenTs),
      });
    }
  }
  const offers = Array.from(map.values());

  // 表示用代表値（最安）
  const min = offers.reduce<Offer | undefined>(
    (a, b) => (!a || b.price < a.price ? b : a),
    undefined
  );
  const displayPrice = min?.price ?? existing.price;
  const displayUrl = existing.affiliateUrl ?? min?.url;

  // 価格履歴（最安が変動したら追記）
  const last: PricePoint | undefined = existing.priceHistory.at(-1);
  const priceHistory =
    typeof displayPrice === "number" && (!last || last.price !== displayPrice)
      ? [
          ...existing.priceHistory,
          { ts: now, source: min?.source ?? "rakuten", price: displayPrice },
        ]
      : existing.priceHistory;

  return {
    ...existing,
    productName:
      existing.productName.length <= incoming.productName.length
        ? incoming.productName
        : existing.productName,
    brand: existing.brand ?? incoming.brand,
    imageUrl: existing.imageUrl ?? incoming.imageUrl,
    price: displayPrice,
    affiliateUrl: displayUrl,
    offers,
    priceHistory,
    // スペックは埋まっていない方を埋める
    capacity: existing.capacity ?? incoming.capacity,
    outputPower: existing.outputPower ?? incoming.outputPower,
    weight: existing.weight ?? incoming.weight,
    hasTypeC: existing.hasTypeC ?? incoming.hasTypeC,
    updatedAt: now,
  };
}
