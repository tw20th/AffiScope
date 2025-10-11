// apps/web/lib/site-catalog.ts
// サイト定義を firebase/functions/sites/*.json から自動ロード（ビルド時）
// ※ サーバ専用モジュール。クライアントから import しないこと。
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
  domain: string; // canonical domain (e.g. "www.chairscope.com" or "chairscope.com")
  brand: Brand;
  features: { blogs?: boolean; ranking?: boolean };
  analytics?: SiteAnalytics;
};

export type SiteCatalog = {
  generatedAt: number;
  sites: SiteEntry[];
};

// --------- ローダー ---------
function loadSitesFromJson(): SiteEntry[] {
  const dir = resolveSitesDir();

  // JSONファイルを列挙
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
      };

      sites.push(entry);
    } catch (e) {
      // 1ファイル壊れていても他は読めるようにする
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

// exact match 用に www 有無も吸収したマップを用意
export const domainToSiteId: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const s of siteCatalog.sites) {
    const canonical = s.domain.toLowerCase();
    map[canonical] = s.siteId;
    // www なし / あり の揺れも同一視
    const naked = canonical.replace(/^www\./, "");
    map[naked] = s.siteId;
    map[`www.${naked}`] = s.siteId;
  }
  return map;
})();
