// firebase/functions/src/lib/ingestHelpers.ts
import { z } from "zod";

export const ProductUpdateSchema = z
  .object({
    siteId: z.string(),
    asin: z.string(),
    title: z.string().optional(),
    url: z.string().url().optional(),
    affiliateUrl: z.string().url().optional(),
    categoryId: z.string().optional(),
    slug: z.string().optional(),
    bestPrice: z.object({ price: z.number().int().positive() }).optional(),
    priceHistory: z
      .array(
        z.object({ price: z.number(), source: z.string(), ts: z.number() })
      )
      .optional(),
    offers: z
      .array(
        z.object({
          source: z.literal("amazon"),
          url: z.string().url(),
          price: z.number().int().positive().optional(),
          lastSeenAt: z.number(),
        })
      )
      .optional(),
    availability: z.enum(["in_stock", "out_of_stock", "unknown"]).optional(),
    inStock: z.boolean().optional(),
    lastSeenAt: z.number().optional(),
    updatedAt: z.number().optional(),
    specs: z
      .object({
        material: z.string().optional(),
        features: z.array(z.string()).optional(),
        dimensions: z
          .object({
            height: z
              .object({ value: z.number(), unit: z.string() })
              .optional(),
            length: z
              .object({ value: z.number(), unit: z.string() })
              .optional(),
            width: z.object({ value: z.number(), unit: z.string() }).optional(),
            weight: z
              .object({ value: z.number(), unit: z.string() })
              .optional(),
          })
          .optional(),
      })
      .partial()
      .optional(),
    // 派生フィールド
    tags: z.array(z.string()).optional(),
    aiSummary: z.string().optional(),
  })
  .partial()
  .required();

export function pruneUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj))
    return obj.map(pruneUndefinedDeep).filter((v) => v !== undefined) as any;
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      const pv = pruneUndefinedDeep(v as any);
      if (
        pv !== undefined &&
        !(
          typeof pv === "object" &&
          !Array.isArray(pv) &&
          Object.keys(pv).length === 0
        )
      ) {
        out[k] = pv;
      }
    }
    return out;
  }
  return obj;
}

export function buildSlug(siteId: string, asin: string) {
  return `${siteId}_${asin}`;
}

export function buildAffiliateUrl(asin: string, partnerTag: string) {
  return `https://www.amazon.co.jp/dp/${asin}?tag=${partnerTag}&linkCode=ogi&th=1&psc=1`;
}

export function inferAvailability(price?: number) {
  if (typeof price === "number" && price > 0)
    return { availability: "in_stock" as const, inStock: true };
  return { availability: "unknown" as const, inStock: false };
}

// 簡易サマリ（ベースライン）: タイトル + 価格帯 + タグ上位1-2個
export function makeAiSummary(title?: string, price?: number, tags?: string[]) {
  const tagText =
    tags && tags.length ? `（${tags.slice(0, 2).join(" / ")}）` : "";
  const priceBand =
    typeof price === "number"
      ? price < 10000
        ? "〜1万円"
        : price < 30000
        ? "〜3万円"
        : "3万円以上"
      : "価格不明";
  return `${title ?? "商品"}の概要。価格帯: ${priceBand}${tagText}`;
}
