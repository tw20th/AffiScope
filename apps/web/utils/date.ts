// apps/web/utils/date.ts
export function formatJpDate(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
