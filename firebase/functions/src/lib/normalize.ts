// firebase/functions/src/lib/normalize.ts
import type { AmazonOffer } from "../fetchers/amazon/paapi.js";

export function normalizeProductFromOffer(asin: string, o: AmazonOffer) {
  const price = o.price;
  const url = o.url;
  const title = o.title;
  const brand = o.brand;
  const imageUrl = o.imageUrl;

  const bestPrice =
    typeof price === "number" ? { source: "amazon", price } : undefined;

  // availability / inStock の推定（価格が取れて URL があれば in stock とみなすだけの簡易版）
  const inStock = typeof price === "number";
  const availability = inStock ? "in_stock" : "unknown";

  // specs
  const specs: any = {};
  if (o.material !== undefined) specs.material = o.material || "";
  if (Array.isArray(o.features)) specs.features = o.features;
  if (o.dimensions) specs.dimensions = o.dimensions;

  const doc: any = {
    asin,
    title,
    brand,
    imageUrl,
    url,
    price,
    bestPrice,
    inStock,
    availability,
    specs,
  };

  // 空オブジェクトは保存しない（ignoreUndefinedProperties でも undefined は除外だが空は残るため）
  if (!specs.material && !specs.features?.length && !specs.dimensions)
    delete doc.specs;

  return doc;
}
