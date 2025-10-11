// apps/web/lib/gtag.ts

// ---- GA の型宣言（TSエラー対策）-----------------
declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}
export {};

// ---- public API ----------------------------------
export const pageview = (measurementId: string, url: string) => {
  if (typeof window === "undefined") return;
  if (!window.gtag || !measurementId) return;
  window.gtag("config", measurementId, { page_path: url });
};

export const gaEvent = (
  measurementId: string,
  action: string,
  params?: Record<string, any>
) => {
  if (typeof window === "undefined") return;
  if (!window.gtag || !measurementId) return;
  window.gtag("event", action, params || {});
};
