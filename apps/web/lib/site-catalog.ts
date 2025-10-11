// apps/web/lib/site-catalog.ts
import "server-only";
import fs from "fs";
import path from "path";
import { resolveSitesDir } from "./paths";

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
  /** ← 追加：デフォルトカテゴリ（sites/*.json の categoryPreset を反映） */
  categoryPreset?: string[];
};

export type SiteCatalog = {
  generatedAt: number;
  sites: SiteEntry[];
};

// --------- ローダー ---------
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
        siteId: j.siteId,
        displayName: j.displayName ?? j.siteId,
        domain: (j.domain as string) || "localhost",
        brand: {
          primary: j.brand?.primary ?? "#111827",
          accent: j.brand?.accent ?? "#22D3EE",
          logoUrl: j.brand?.logoUrl ?? "/logos/default.svg",
          theme: (j.brand?.theme as "light" | "dark") ?? "light",
        },
        features: j.features ?? {},
        analytics: j.analytics ?? {},
        // ★ ここで通す
        categoryPreset: Array.isArray(j.categoryPreset) ? j.categoryPreset : [],
      };

      sites.push(entry);
    } catch (e) {
      console.warn(`[site-catalog] failed to read ${file}:`, e);
    }
  }

  return sites;
}

// --------- 実体（ビルド時に確定）---------
export const siteCatalog: SiteCatalog = {
  generatedAt: Date.now(),
  sites: loadSitesFromJson(),
} as const;

// exact match 用に www 有無も吸収したマップ
export const domainToSiteId: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const s of siteCatalog.sites) {
    const canonical = s.domain.toLowerCase();
    map[canonical] = s.siteId;
    const naked = canonical.replace(/^www\./, "");
    map[naked] = s.siteId;
    map[`www.${naked}`] = s.siteId;
  }
  return map;
})();
