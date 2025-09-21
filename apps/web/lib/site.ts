// ★ next/headers を import しない（クライアントでも動く版）
export const COOKIE_SITE_ID = "siteId";
export const SITE_ID = process.env.NEXT_PUBLIC_SITE_ID || "affiscope";

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

export function getSiteId(): string {
  return readCookie(COOKIE_SITE_ID) || SITE_ID;
}
