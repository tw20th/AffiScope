// packages/shared-schemas/src/index.ts
import { z } from "zod";

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

export const ProductSchema = z.object({
  asin: z.string(),
  title: z.string(),
  brand: z.string().optional(),
  imageUrl: z.string().url().optional(),
  categoryId: z.string(),
  siteId: z.string(), // 必須
  tags: z.array(z.string()).optional(),
  specs: z
    .object({
      capacityMah: z.number().optional(),
      outputW: z.number().optional(),
      weightG: z.number().optional(),
      ports: z.array(z.string()).optional(),
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
  views: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ProductParsed = z.infer<typeof ProductSchema>;
