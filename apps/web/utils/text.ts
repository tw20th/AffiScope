export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "") // fenced code
    .replace(/!\[[^\]]*]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]*)]\([^)]+\)/g, "$1") // links -> label
    .replace(/[#>*_`~-]+/g, "") // md symbols
    .replace(/\r?\n\s*\r?\n/g, "\n") // compress blanks
    .trim();
}

export function summaryFromContent(
  md: string,
  maxLines = 2,
  maxChars = 160
): string {
  const plain = stripMarkdown(md);
  const lines = plain.split(/\r?\n/).filter(Boolean).slice(0, maxLines);
  const joined = lines.join(" / ").trim();
  return joined.length > maxChars
    ? joined.slice(0, maxChars - 1) + "…"
    : joined;
}
