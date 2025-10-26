// 旧: export function dailySlug(siteId: string, asin: string)
export function dailySlug(siteId: string, productKey: string) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${siteId}_${productKey}_${ymd}`;
}
