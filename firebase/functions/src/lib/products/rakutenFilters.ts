// firebase/functions/src/lib/products/rakutenFilters.ts
import { getSiteConfig } from "../sites/siteConfig.js";

type ProductRules = {
  includeKeywords?: string[];
  excludeKeywords?: string[];
};

function toRules(v: any): ProductRules {
  const isStr = (x: any) => typeof x === "string" && x.trim().length > 0;
  const r: ProductRules = {};
  if (v && Array.isArray(v.includeKeywords)) {
    r.includeKeywords = v.includeKeywords.filter(isStr);
  }
  if (v && Array.isArray(v.excludeKeywords)) {
    r.excludeKeywords = v.excludeKeywords.filter(isStr);
  }
  return r;
}

function normalizeTitle(title: string): string {
  return String(title || "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/送料無料|公式|SALE|セール|楽天/gi, "")
    .toLowerCase();
}

/**
 * 楽天取り込み時のタイトルフィルタ
 * - include が1つ以上あれば、タイトルにいずれかが含まれることが必須
 * - exclude に1つでも当たれば除外
 */
export async function shouldKeepRakutenItem(params: {
  siteId: string;
  title: string;
}): Promise<boolean> {
  const { siteId, title } = params;

  const site = await getSiteConfig(siteId);
  const rules = toRules(site?.productRules || {});
  const include = rules.includeKeywords || [];
  const exclude = rules.excludeKeywords || [];

  const t = normalizeTitle(title);

  if (include.length > 0) {
    const ok = include.some((k) => t.includes(String(k).toLowerCase()));
    if (!ok) return false;
  }

  if (exclude.length > 0) {
    const ng = exclude.some((k) => t.includes(String(k).toLowerCase()));
    if (ng) return false;
  }

  return true;
}
