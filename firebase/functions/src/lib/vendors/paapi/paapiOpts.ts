import type {
  Marketplace,
  SitePaapiConfig,
} from "../../../services/paapi/client.js";

export type SiteLike = {
  affiliate?: {
    amazon?: {
      marketplace?: string; // e.g. "www.amazon.co.jp"
      partnerTag?: string; // e.g. "tw20th0c-22"
      resources?: string[];
      accessKey?: string; // optional (fallback is env)
      secretKey?: string;
      // optional rate overrides (omit to use env)
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
    : host.includes("amazon.com") && !host.includes("co.uk")
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

  // NOTE:
  // - accessKey/secretKey/partnerTag は client.ts 側で env フォールバック
  // - tps/burst/tpdMax は「数値が入ってる時だけ」渡す（= 未設定なら env を優先）
  const out: SitePaapiConfig = {
    accessKey: a.accessKey,
    secretKey: a.secretKey,
    partnerTag: a.partnerTag || process.env.AMAZON_PARTNER_TAG,
    marketplace,
    resources:
      Array.isArray(a.resources) && a.resources.length
        ? a.resources.slice()
        : undefined,
  };

  if (typeof a.tps === "number") out.tps = a.tps;
  if (typeof a.burst === "number") out.burst = a.burst;
  if (typeof a.tpdMax === "number") out.tpdMax = a.tpdMax;

  // たまに混線するのでデバッグ出力を残す（必要な時だけ）
  // console.log("[paapi cfg]", {
  //   marketplace: out.marketplace, partnerTag: out.partnerTag,
  //   tps: out.tps, burst: out.burst, tpdMax: out.tpdMax,
  //   resources: out.resources
  // });

  return out;
}
