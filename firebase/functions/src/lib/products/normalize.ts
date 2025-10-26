// NOTE: paapi.js に 'AmazonOffer' 型はエクスポートされていないため、
// ここでは必要最小限のローカル型で受けます。
type AmazonOfferLike = {
  asin?: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  price?: number;
  url?: string;

  // 仕様が変わっても安全なように optional にしておく
  material?: string;
  features?: string[];
  dimensions?: unknown;
};

export function normalizeProductFromOffer(asin: string, o: AmazonOfferLike) {
  const price = o.price;
  const url = o.url;
  const title = o.title;
  const brand = o.brand;
  const imageUrl = o.imageUrl;

  const bestPrice =
    typeof price === "number" ? { source: "amazon", price } : undefined;

  // availability / inStock の推定（価格が取れれば in stock 扱い）
  const inStock = typeof price === "number";
  const availability = inStock ? "in_stock" : "unknown";

  // specs
  const specs: Record<string, unknown> = {};
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

  // 空の specs は保存しない
  if (!specs.material && !Array.isArray(specs.features) && !specs.dimensions) {
    delete doc.specs;
  }

  return doc;
}
