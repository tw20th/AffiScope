// apps/web/lib/site-server.ts
import "server-only";
import { cookies, headers } from "next/headers";
import { coerceSiteId, siteCatalog, type SiteEntry } from "./site-catalog";

/**
 * サーバで使う最終 siteId を決定。
 * 優先: Cookie(siteId) > Host 推定 > 環境変数/既定
 */
export function getServerSiteId(): string {
  const ck = cookies().get("siteId")?.value?.trim();
  const host = headers().get("host");
  const def =
    process.env.NEXT_PUBLIC_SITE_ID ||
    process.env.DEFAULT_SITE_ID ||
    "chairscope";
  return coerceSiteId(ck, host, def);
}

/**
 * 現在の siteId に対応する SiteEntry を返す（安全フォールバック付）
 */
export function getSiteEntry(): SiteEntry {
  const siteId = getServerSiteId();
  const entry = siteCatalog.sites.find((s) => s.siteId === siteId);
  if (entry) return entry;

  // 開発時は警告して先頭にフォールバック
  if (process.env.NODE_ENV !== "production") {
    console.warn("[site] Unknown siteId:", siteId, "-> fallback to first");
  }
  return siteCatalog.sites[0]!;
}
