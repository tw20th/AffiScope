// apps/web/lib/site-catalog.ts
import "server-only";
import fs from "fs";
import path from "path";
import { resolveSitesDir } from "./paths";

/* =============================
 * Types
 * ============================= */
export type Brand = {
  primary: string;
  accent: string;
  logoUrl: string;
  theme: "light" | "dark";
};

export type SiteAnalytics = {
  ga4MeasurementId?: string;
  hotjarSiteId?: number;
  clarityProjectId?: string;
};

export type SiteEntry = {
  siteId: string;
  displayName: string;
  domain: string; // e.g. "www.chairscope.com"
  brand: Brand;
  features: { blogs?: boolean; ranking?: boolean };
  analytics?: SiteAnalytics;
  /** sites/*.json の categoryPreset を反映 */
  categoryPreset?: string[];
};

export type SiteCatalog = {
  generatedAt: number;
  sites: SiteEntry[];
};

/* =============================
 * Loader
 * ============================= */
function loadSitesFromJson(): SiteEntry[] {
  const dir = resolveSitesDir();
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => path.join(dir, d.name));

  const sites: SiteEntry[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const j = JSON.parse(raw) as any;

      const entry: SiteEntry = {
        siteId: String(j.siteId),
        displayName: (j.displayName as string) ?? String(j.siteId),
        domain: (j.domain as string) || "localhost",
        brand: {
          primary: j.brand?.primary ?? "#111827",
          accent: j.brand?.accent ?? "#22D3EE",
          logoUrl: j.brand?.logoUrl ?? "/logos/default.svg",
          theme: (j.brand?.theme as "light" | "dark") ?? "light",
        },
        features: j.features ?? {},
        analytics: j.analytics ?? {},
        categoryPreset: Array.isArray(j.categoryPreset) ? j.categoryPreset : [],
      };

      sites.push(entry);
    } catch (e) {
      console.warn(`[site-catalog] failed to read ${file}:`, e);
    }
  }

  return sites;
}

/* =============================
 * Catalog (built at startup)
 * ============================= */
export const siteCatalog: SiteCatalog = {
  generatedAt: Date.now(),
  sites: loadSitesFromJson(),
} as const;

/* =============================
 * Domain → siteId map（www 有無も吸収）
 * ============================= */
export const domainToSiteId: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const s of siteCatalog.sites) {
    const canonical = s.domain.toLowerCase();
    const naked = canonical.replace(/^www\./, "");
    if (canonical) map[canonical] = s.siteId;
    if (naked) {
      map[naked] = s.siteId;
      map[`www.${naked}`] = s.siteId;
    }
  }
  return map;
})();

/* =============================
 * Helpers（ミドルウェア/サーバー用）
 * ============================= */

/** 許可サイトIDの集合（未知の siteId を弾く用途に） */
export const ALLOWED_SITE_IDS = new Set(siteCatalog.sites.map((s) => s.siteId));

/** 先頭のサイトID（フォールバック用） */
export function getFirstSiteId(): string {
  return siteCatalog.sites[0]?.siteId ?? "chairscope";
}

/** Host から siteId を推定（見つからなければ undefined） */
export function getSiteIdForHost(host?: string | null): string | undefined {
  if (!host) return undefined;
  const key = host.toLowerCase();
  return domainToSiteId[key];
}

/**
 * siteId の最終決定（安全版）
 * 優先順: 明示 siteId（有効なとき） > Host 由来 > DEFAULT/先頭
 */
export function coerceSiteId(
  candidate?: string | null,
  host?: string | null,
  defaultSiteId?: string
): string {
  // 1) 候補（クエリ/クッキーなど）を優先。ただし許可済みのみ採用
  if (candidate && ALLOWED_SITE_IDS.has(candidate)) return candidate;

  // 2) ホストから推定
  const fromHost = getSiteIdForHost(host);
  if (fromHost && ALLOWED_SITE_IDS.has(fromHost)) return fromHost;

  // 3) 指定の DEFAULT、無ければ先頭
  const fallback =
    defaultSiteId && ALLOWED_SITE_IDS.has(defaultSiteId)
      ? defaultSiteId
      : getFirstSiteId();

  return fallback;
}
