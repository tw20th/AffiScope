// firebase/functions/src/lib/slug/daily.ts

/**
 * ブログ記事用の一意スラッグを生成する。
 * productKey に「:」や「/」などが含まれる場合は自動的に URL 安全な形にエンコードする。
 *
 * 例:
 *   dailySlug("chairscope", "clovertradingshop:10000018")
 *   → "chairscope_clovertradingshop%3A10000018_20251026"
 */
export function dailySlug(siteId: string, productKey: string): string {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(today.getDate()).padStart(2, "0")}`;

  // 「:」「/」「?」などURLに使えない文字を常に安全化
  const safeKey = encodeURIComponent(productKey);

  // 形式を統一（siteId_productKey_yyyymmdd）
  return `${siteId}_${safeKey}_${ymd}`;
}
