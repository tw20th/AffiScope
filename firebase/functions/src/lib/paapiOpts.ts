// firebase/functions/src/lib/paapiOpts.ts
import type { Marketplace, SitePaapiConfig } from "../services/paapi/client.js";

export type SiteLike = {
  affiliate?: {
    amazon?: {
      marketplace?: string; // 例: "www.amazon.co.jp"
      partnerTag?: string; // 例: "tw20th0c-22"
      resources?: string[];
      accessKey?: string; // 任意（なければ環境変数）
      secretKey?: string;
      // レート（任意）
      tps?: number;
      burst?: number;
      tpdMax?: number;
    };
  };
};

export function getPaapiOptionsFromSite(site: SiteLike): SitePaapiConfig {
  const a = site?.affiliate?.amazon ?? {};
  const host = String(a.marketplace ?? "").toLowerCase();

  const marketplace: Marketplace = host.includes("co.jp")
    ? "JP"
    : host.includes("amazon.com")
    ? "US"
    : host.includes("co.uk")
    ? "UK"
    : host.includes("amazon.de")
    ? "DE"
    : host.includes("amazon.fr")
    ? "FR"
    : host.includes("amazon.it")
    ? "IT"
    : host.includes("amazon.es")
    ? "ES"
    : host.includes("amazon.ca")
    ? "CA"
    : host.includes("amazon.in")
    ? "IN"
    : "JP";

  return {
    accessKey: a.accessKey, // なければ env を client.ts 側でフォールバック
    secretKey: a.secretKey,
    partnerTag: a.partnerTag || process.env.AMAZON_PARTNER_TAG,
    marketplace,
    resources:
      Array.isArray(a.resources) && a.resources.length
        ? a.resources.slice()
        : undefined,
    tps: a.tps,
    burst: a.burst,
    tpdMax: a.tpdMax,
  };
}
