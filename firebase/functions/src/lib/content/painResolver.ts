import type { SiteConfig } from "../../types/site.js";

type ProductLite = { tags?: string[] };

export function resolvePain(
  site: SiteConfig | null,
  product: ProductLite
): { pain: string; persona: string } {
  const tags = new Set((product.tags ?? []).map((t) => String(t)));
  const persona = site?.defaultPersona ?? "一般ユーザー";

  if (!site?.painRules?.length) {
    return { pain: "コスパよく失敗したくない", persona };
  }

  for (const rule of site.painRules) {
    const anyTags = rule.match?.anyTags ?? [];
    if (anyTags.some((t: string) => tags.has(t))) {
      return {
        pain: rule.label,
        persona: (rule.personas && rule.personas[0]) || persona,
      };
    }
  }

  // フォールバック
  return { pain: "コスパよく失敗したくない", persona };
}
