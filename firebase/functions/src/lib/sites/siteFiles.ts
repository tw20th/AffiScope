import * as fs from "node:fs";
import * as path from "node:path";

export type SiteJson = {
  siteId: string;
  displayName?: string;
  domain?: string;
  brand?: unknown;
  categoryPreset?: string[];
  productRules?: {
    includeKeywords?: string[];
    excludeKeywords?: string[];
  };
  tagRules?: unknown[];
  painRules?: unknown[];
  [k: string]: unknown;
};

const SITES_DIR = path.resolve(process.cwd(), "sites");
let _cacheAll: SiteJson[] | null = null;

export function loadAllSites(): SiteJson[] {
  if (_cacheAll) return _cacheAll;
  if (!fs.existsSync(SITES_DIR)) return (_cacheAll = []);
  const files = fs.readdirSync(SITES_DIR).filter((f) => f.endsWith(".json"));
  _cacheAll = files
    .map((f) => JSON.parse(fs.readFileSync(path.join(SITES_DIR, f), "utf-8")))
    .sort((a, b) => a.siteId.localeCompare(b.siteId));
  return _cacheAll!;
}

export function getSite(siteId: string): SiteJson | null {
  return loadAllSites().find((s) => s.siteId === siteId) ?? null;
}
