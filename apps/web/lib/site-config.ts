// apps/web/lib/site-config.ts
import { getSiteEntry } from "./site-server";
import type { SiteEntry, SiteAnalytics } from "./site-catalog";

export type SiteConfig = {
  siteId: string;
  title: string;
  description: string;
  urlOrigin: string;
  brandColor: string;
  logoUrl: string;
  theme: "light" | "dark";
  analytics?: SiteAnalytics;
};

export function getSiteConfig(): SiteConfig {
  const s: SiteEntry = getSiteEntry();

  // ローカル(127.0.0.1/localhost)のときは http、それ以外は https
  const proto = /(^|\.)localhost$|(^|\.)127\.0\.0\.1$/.test(s.domain)
    ? "http"
    : "https";
  const urlOrigin = `${proto}://${s.domain}`;

  const gaFromEntry = s.analytics?.ga4MeasurementId;
  const gaFromEnv = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const analytics: SiteAnalytics | undefined =
    gaFromEntry || gaFromEnv
      ? { ...s.analytics, ga4MeasurementId: gaFromEntry ?? gaFromEnv }
      : s.analytics;

  return {
    siteId: s.siteId,
    title: s.displayName,
    description: `${s.displayName} - 比較・レビュー・おすすめ情報を毎日自動更新。`,
    urlOrigin,
    brandColor: s.brand.primary,
    logoUrl: s.brand.logoUrl,
    theme: s.brand.theme,
    analytics,
  };
}
