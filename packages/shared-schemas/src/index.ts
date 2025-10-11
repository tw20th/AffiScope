// packages/shared-schemas/src/index.ts
import { z } from "zod";

// ---- offers / price history ----
export const OfferSourceSchema = z.enum(["amazon", "rakuten"]);

export const OfferSchema = z.object({
  source: OfferSourceSchema,
  price: z.number(),
  url: z.string().url(),
  lastSeenAt: z.number(),
});

export const PricePointSchema = z.object({
  ts: z.number(),
  source: OfferSourceSchema,
  price: z.number(),
});

// ---- product ----
const DimensionsSchema = z
  .object({
    widthMm: z.number().optional(),
    heightMm: z.number().optional(),
    depthMm: z.number().optional(),
    // 文字列でしか取れないケース用のフォールバック
    text: z.string().optional(),
  })
  .optional();

export const ProductSchema = z.object({
  asin: z.string(), // 必要なら .regex(/^[A-Z0-9]{10}$/) も可
  title: z.string(),
  brand: z.string().optional(),
  imageUrl: z.string().url().optional(),

  categoryId: z.string(),
  siteId: z.string(), // 必須

  tags: z.array(z.string()).optional(),

  // 仕様（カテゴリ横断で使う項目は optional で広めに）
  specs: z
    .object({
      capacityMah: z.number().optional(), // power bank 向け
      outputW: z.number().optional(),
      weightG: z.number().optional(),
      ports: z.array(z.string()).optional(),

      // ここから追加（タグ判定や表示用）
      features: z.array(z.string()).optional(), // ★ tagRules で参照
      material: z.string().optional(), // ★ tagRules で参照
      dimensions: DimensionsSchema, // 任意の寸法
    })
    .optional(),

  offers: z.array(OfferSchema).default([]),

  bestPrice: z
    .object({
      price: z.number(),
      source: OfferSourceSchema,
      url: z.string().url(),
      updatedAt: z.number(),
    })
    .optional(),

  priceHistory: z.array(PricePointSchema).default([]),

  aiSummary: z.string().optional(),

  // 運用メタ
  views: z.number().optional(),
  pinned: z.boolean().optional(), // ★ 固定表示フラグ
  freshUntil: z.number().optional(), // ★ 鮮度の期限（ホット昇格などで更新）

  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ProductParsed = z.infer<typeof ProductSchema>;
