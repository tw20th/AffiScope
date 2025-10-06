// firebase/functions/src/lib/tagging.ts
import { getSiteConfig } from "./siteConfig.js";
import { z } from "zod";

const RuleSchema = z.object({
  tag: z.string(),
  any: z.array(
    z.union([
      z.object({ type: z.literal("featureMatches"), pattern: z.string() }),
      z.object({ type: z.literal("materialMatches"), pattern: z.string() }),
      z.object({ type: z.literal("titleMatches"), pattern: z.string() }),
      z.object({ type: z.literal("bestPriceLte"), value: z.number() }),
      z.object({ type: z.literal("all"), all: z.any() }),
      z.object({ type: z.literal("or"), any: z.any() }),
      z.object({ type: z.literal("tagWillBe"), tag: z.string() }),
    ])
  ),
});

export type ProductLike = {
  title?: string;
  specs?: { features?: string[]; material?: string };
  bestPrice?: { price?: number };
};

export async function retagBySiteRules(
  siteId: string,
  p: ProductLike
): Promise<string[]> {
  const site = await getSiteConfig(siteId);
  const rules = (site?.tagRules || []).map((r: any) => RuleSchema.parse(r));

  const will = new Set<string>();
  const ctx = {
    title: p.title || "",
    features: (p.specs?.features || []).join(" / "),
    material: p.specs?.material || "",
    price: p.bestPrice?.price,
    hasTag: (t: string) => will.has(t),
  };

  const evalCond = (cond: any): boolean => {
    switch (cond.type) {
      case "featureMatches":
        return new RegExp(cond.pattern, "i").test(ctx.features);
      case "materialMatches":
        return new RegExp(cond.pattern, "i").test(ctx.material);
      case "titleMatches":
        return new RegExp(cond.pattern, "i").test(ctx.title);
      case "bestPriceLte":
        return typeof ctx.price === "number" && ctx.price <= cond.value;
      case "tagWillBe":
        return ctx.hasTag(cond.tag);
      case "all":
        return Array.isArray(cond.all) && cond.all.every(evalCond);
      case "or":
      case "any":
        return Array.isArray(cond.any) && cond.any.some(evalCond);
      default:
        return false;
    }
  };

  for (const r of rules) if (r.any.some(evalCond)) will.add(r.tag);
  return Array.from(will);
}
