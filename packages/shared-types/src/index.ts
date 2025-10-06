// packages/shared-types/src/index.ts
export type OfferSource = "amazon" | "rakuten";

export interface Offer {
  source: OfferSource;
  price: number;
  url: string;
  lastSeenAt: number; // ms
}

export interface PricePoint {
  ts: number; // ms
  source: OfferSource;
  price: number;
}

export interface ProductSpecs {
  capacityMah?: number;
  outputW?: number;
  weightG?: number;
  ports?: string[];
}

export interface BestPrice {
  price: number;
  source: OfferSource;
  url: string;
  updatedAt: number; // ms
}

export interface Product {
  // ---- 必須（既存） ----
  asin: string;
  title: string;
  brand?: string;
  imageUrl?: string;
  categoryId: string;
  siteId: string;

  tags?: string[];
  specs?: ProductSpecs;
  offers: Offer[];
  bestPrice?: BestPrice;
  priceHistory: PricePoint[];
  aiSummary?: string;
  views?: number;
  createdAt: number;
  updatedAt: number;

  // 追加（実データ準拠の optional）
  affiliateUrl?: string;
  url?: string;
  inStock?: boolean;
  lastSeenAt?: number; // ms
  source?: OfferSource; // "amazon" | "rakuten"
}

export type BlogStatus = "draft" | "published";

export interface Blog {
  slug: string; // = docId
  title: string;
  imageUrl?: string;
  relatedAsin?: string;
  categoryId?: string;
  content: string; // Markdown
  summary?: string;
  tags: string[];
  status: BlogStatus;
  views: number;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string; // = docId
  siteId: string; // 必須
  name: string;
  slug: string;
  parentId?: string;
  path: string[]; // 先祖 slug の配列（root→...→self）
  order: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Improvement {
  id: string; // = docId
  target: { type: "blog" | "product"; id: string };
  scoreBefore?: number;
  scoreAfter?: number;
  suggestions: string[];
  createdAt: number;
}
