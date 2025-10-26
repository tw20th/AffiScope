import fs from "node:fs";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import type { SiteConfig } from "../../types/site.js";

/** sites/<siteId>.json を読むローカル設定ローダ（メモリキャッシュ付） */
const cache = new Map<string, SiteConfig | null>();

export function getSiteConfig(siteId: string): SiteConfig | null {
  if (cache.has(siteId)) return cache.get(siteId)!;
  const p = path.resolve(process.cwd(), `sites/${siteId}.json`);
  if (!fs.existsSync(p)) {
    cache.set(siteId, null);
    return null;
  }
  const conf = JSON.parse(fs.readFileSync(p, "utf-8")) as SiteConfig;
  cache.set(siteId, conf);
  return conf;
}

/** Firestore の sites コレクションから blogs フラグ有効な siteId を列挙 */
export async function getBlogEnabledSiteIds(db: Firestore): Promise<string[]> {
  const snap = await db
    .collection("sites")
    .where("features.blogs", "==", true)
    .get();

  return snap.docs
    .map((d) => (d.data() as { siteId?: string }).siteId)
    .filter(Boolean) as string[];
}
