import { getSiteEntry } from "./site-server";
import type { SiteEntry, SiteAnalytics } from "./site-catalog";

export type SiteConfig = {
  siteId: string;
  title: string;
  description: string;
  urlOrigin: string; // e.g. https://www.xxx.com
  brandColor: string;
  logoUrl: string;
  theme: "light" | "dark";
  analytics?: SiteAnalytics; // ← 追加
};

export function getSiteConfig(): SiteConfig {
  const s: SiteEntry = getSiteEntry();
  const urlOrigin = `https://${s.domain}`;

  // JSON / catalog 側が未設定でも環境変数で代替できるようにフォールバック
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
