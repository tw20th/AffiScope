export const stripMarkdown = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~-]+/g, "")
    .replace(/\r?\n\s*\r?\n/g, "\n")
    .trim();

export const summaryFromContent = (
  md: string,
  maxLines = 2,
  maxChars = 160
): string => {
  const plain = stripMarkdown(md);
  const lines = plain.split(/\r?\n/).filter(Boolean).slice(0, maxLines);
  const joined = lines.join(" / ").trim();
  return joined.length > maxChars
    ? joined.slice(0, maxChars - 1) + "…"
    : joined;
};
