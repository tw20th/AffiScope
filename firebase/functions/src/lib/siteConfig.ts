// firebase/functions/src/lib/siteConfig.ts
import { promises as fs } from "node:fs";
import path from "node:path";

export type SiteConfig = {
  siteId: string;
  displayName?: string;
  domain?: string;
  brand?: unknown;
  categoryPreset?: string[];
  productRules?: unknown;
  affiliate?: {
    amazon?: {
      partnerTag?: string;
    };
    [k: string]: any;
  };
  tagRules?: Array<any>;
  discovery?: any;
  [k: string]: any;
};

const cache = new Map<string, SiteConfig | null>();

export async function getSiteConfig(
  siteId: string
): Promise<SiteConfig | null> {
  if (cache.has(siteId)) return cache.get(siteId)!;

  const file = path.resolve(process.cwd(), "sites", `${siteId}.json`);
  try {
    const json = await fs.readFile(file, "utf-8");
    const cfg = JSON.parse(json) as SiteConfig;
    cache.set(siteId, cfg);
    return cfg;
  } catch {
    cache.set(siteId, null);
    return null;
  }
}
