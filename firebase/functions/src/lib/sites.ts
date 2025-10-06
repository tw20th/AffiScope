// firebase/functions/src/lib/sites.ts
import fs from "node:fs";
import path from "node:path";
import type { SiteConfig } from "../types/site.js";

const cache = new Map<string, SiteConfig>();

export function getSiteConfig(siteId: string): SiteConfig | null {
  if (cache.has(siteId)) return cache.get(siteId)!;
  const p = path.resolve(process.cwd(), `sites/${siteId}.json`);
  if (!fs.existsSync(p)) return null;
  const conf = JSON.parse(fs.readFileSync(p, "utf-8")) as SiteConfig;
  cache.set(siteId, conf);
  return conf;
}
