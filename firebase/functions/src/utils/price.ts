// firebase/functions/src/utils/price.ts
import type { Product, BestPrice } from '@affiscope/shared-types';

export function computeBestPrice(p: Pick<Product, 'offers'>): BestPrice | undefined {
  if (!p.offers?.length) return undefined;
  const best = [...p.offers].sort((a, b) => a.price - b.price)[0];
  return { price: best.price, source: best.source, url: best.url, updatedAt: Date.now() };
}
