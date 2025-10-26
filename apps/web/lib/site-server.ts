// apps/web/lib/site-server.ts
import { headers, cookies } from "next/headers"; // ← 追加
import { domainToSiteId, siteCatalog, type SiteEntry } from "./site-catalog";

function normalizeHost(raw: string): string {
  const lower = raw.toLowerCase();
  return lower.replace(/:\d+$/, "");
}

function getHostFromRequest(): string | "" {
  try {
    const h = headers();
    const hostRaw = h.get("x-forwarded-host") || h.get("host") || "";
    return normalizeHost(hostRaw);
  } catch {
    return "";
  }
}

export function getServerSiteId(): string {
  // 1) middleware が付ける優先ヘッダ
  try {
    const h = headers();
    const fromHeader = h.get("x-site-id")?.trim();
    if (fromHeader) return fromHeader;
  } catch {}

  // 2) Cookie（middleware も付与する）
  try {
    const c = cookies();
    const fromCookie = c.get("siteId")?.value?.trim();
    if (fromCookie) return fromCookie;
  } catch {}

  // 3) Host からの解決
  const host = getHostFromRequest();
  if (host) {
    const byMap = domainToSiteId[host];
    if (byMap) return byMap;
  }

  // 4) 最後のフォールバック
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
