// firebase/functions/src/lib/summary.ts
type SummaryInput = {
  title?: string;
  tags?: string[];
  price?: number;
};

export function buildAiSummary(input: SummaryInput): string {
  const t = (input.title || "").trim();
  const tags = (input.tags || []).slice(0, 3);
  const price = typeof input.price === "number" ? input.price : undefined;

  const parts: string[] = [];
  if (t) parts.push(t);
  if (tags.length) parts.push(`特長: ${tags.join(" / ")}`);
  if (price !== undefined) parts.push(`参考価格: 約¥${price.toLocaleString()}`);
  return parts.join("｜");
}
