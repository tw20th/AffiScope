export type SeoScore = {
  total: number; // 0-100
  checks: Record<string, boolean | number>;
};

export function analyzeMarkdown(md: string): SeoScore {
  const text = md ?? "";
  const len = text.length;
  let score = 50;

  const checks: Record<string, boolean | number> = {};

  // ボリューム
  const volume = Math.min(30, Math.floor(len / 800));
  score += volume;
  checks.volume = volume;

  // 見出し
  const hasH = /^#{1,3}\s/m.test(text);
  if (hasH) score += 5;
  checks.hasHeadings = hasH;

  // 箇条書き
  const hasList = /^\s*[-*+]\s/m.test(text);
  if (hasList) score += 3;
  checks.hasList = hasList;

  // FAQ（見出し or セクション名）
  const hasFaq = /(^|\n)#{2,3}\s*FAQ\b/i.test(text) || /Q\./i.test(text);
  if (hasFaq) score += 5;
  checks.hasFAQ = hasFaq;

  // CTA（Amazon外部リンク）
  const hasCTA = /\(https?:\/\/(?:www\.)?amazon\.co\.jp\/[^\s)]+\)/i.test(text);
  if (hasCTA) score += 5;
  checks.hasCTA = hasCTA;

  // 内部リンク（/products or /blog）
  const hasInternal = /\(\/(products|blog)\/[^\s)]+\)/i.test(text);
  if (hasInternal) score += 4;
  checks.hasInternalLinks = hasInternal;

  // 体験/E-E-A-Tっぽい言及（“使ってみて/検証/編集部調べ/参考情報”など）
  const hasEEAT = /(検証|編集部|参考情報|注意点|デメリット)/.test(text);
  if (hasEEAT) score += 3;
  checks.hasEEAT = hasEEAT;

  // 表（比較記事向け）
  const hasTable = /\n\|.+\|\n\|[-| ]+\|\n/.test(text);
  if (hasTable) score += 3;
  checks.hasTable = hasTable;

  // 構造化データ（FAQやHowToのJSON-LD埋め込みを想定）
  const hasJsonLd = /<script type="application\/ld\+json">/.test(text);
  if (hasJsonLd) score += 2;
  checks.hasJSONLD = hasJsonLd;

  // 上限・下限
  score = Math.max(0, Math.min(100, score));
  return { total: score, checks };
}
