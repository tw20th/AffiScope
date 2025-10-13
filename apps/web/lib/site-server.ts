// apps/web/lib/site-server.ts
import { headers } from "next/headers";
import { domainToSiteId, siteCatalog, type SiteEntry } from "./site-catalog";

function normalizeHost(raw: string): string {
  const lower = raw.toLowerCase();
  return lower.replace(/:\d+$/, "");
}

function getHostFromRequest(): string | "" {
  // リクエストスコープ外では headers() が throw する → 安全に握りつぶす
  try {
    const h = headers();
    const hostRaw = h.get("x-forwarded-host") || h.get("host") || "";
    return normalizeHost(hostRaw);
  } catch {
    return "";
  }
}

export function getServerSiteId(): string {
  const host = getHostFromRequest();

  if (host) {
    const byMap = domainToSiteId[host];
    if (byMap) return byMap;
  }

  // リクエストが無い（ビルド時など）/ マッチしない場合のフォールバック
  return (
    process.env.DEFAULT_SITE_ID || siteCatalog.sites[0]?.siteId || "chairscope"
  );
}

export function getSiteEntry(): SiteEntry {
  const siteId = getServerSiteId();
  const entry = siteCatalog.sites.find((s) => s.siteId === siteId);
  if (!entry) throw new Error(`Unknown siteId: ${siteId}`);
  return entry;
}
