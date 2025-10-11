// apps/web/lib/site-server.ts
import { headers } from "next/headers";
import { domainToSiteId, siteCatalog, type SiteEntry } from "./site-catalog";

function normalizeHost(raw: string): string {
  // ポート除去 + 小文字化
  const lower = raw.toLowerCase();
  return lower.replace(/:\d+$/, "");
}

export function getServerSiteId(): string {
  const h = headers();
  const hostRaw = h.get("x-forwarded-host") || h.get("host") || "";
  const host = normalizeHost(hostRaw);

  // 1) 完全一致 / 揺れを domainToSiteId が吸収
  const byMap = domainToSiteId[host];
  if (byMap) return byMap;

  // 2) フォールバック
  return (
    process.env.DEFAULT_SITE_ID || siteCatalog.sites[0]?.siteId || "chairscope"
  );
}

export function getSiteEntry(): SiteEntry {
  const siteId = getServerSiteId();
  const entry = siteCatalog.sites.find((s: SiteEntry) => s.siteId === siteId);
  if (!entry) {
    throw new Error(`Unknown siteId: ${siteId}`);
  }
  return entry;
}
