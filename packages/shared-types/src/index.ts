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

  // optional
  affiliateUrl?: string;
  url?: string;
  inStock?: boolean;
  lastSeenAt?: number; // ms
  source?: OfferSource; // "amazon" | "rakuten"
}

export type BlogStatus = "draft" | "published";

/** ★ ここを差し替え */
export interface Blog {
  slug: string; // = docId
  title: string;
  imageUrl?: string | null;
  /** Unsplash 帰属（あれば表示） */
  imageCredit?: string | null;
  imageCreditLink?: string | null;

  relatedAsin?: string | null;
  categoryId?: string;
  content: string; // Markdown
  summary?: string | null;
  tags: string[];
  status: BlogStatus;
  views: number;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number | null;
}

export interface Category {
  id: string; // = docId
  siteId: string;
  name: string;
  slug: string;
  parentId?: string;
  path: string[];
  order: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Improvement {
  id: string;
  target: { type: "blog" | "product"; id: string };
  scoreBefore?: number;
  scoreAfter?: number;
  suggestions: string[];
  createdAt: number;
}
