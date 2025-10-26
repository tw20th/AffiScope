export type Offer = {
  source: "rakuten" | "amazon";
  price: number;
  url?: string;
  shopName?: string;
  itemCode?: string; // 楽天: shopCode:itemCode
  lastSeenTs: number;
};

export type PricePoint = { ts: number; source: Offer["source"]; price: number };

export type CatalogProduct = {
  dedupeKey: string; // 1商品=1ドキュメントのキー
  productName: string;
  brand?: string;
  imageUrl?: string;

  // 表示用の代表値
  price?: number; // offers の最安を同期
  affiliateUrl?: string; // 代表のURL（最安の url など）

  // 集約
  offers: Offer[];
  priceHistory: PricePoint[];

  // 抽出済みスペック（ランキングに使う）
  capacity?: { mAh?: number; Wh?: number };
  outputPower?: number; // W
  weight?: number; // g
  hasTypeC?: boolean;

  // 後段で付与
  tags: string[];
  category?: string | null;
  pains?: string[];
  aiSummary?: string;

  // メタ
  updatedAt: number;
  createdAt: number;
};
