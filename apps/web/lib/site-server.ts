import { cookies } from "next/headers"; // ← サーバ専用

export const COOKIE_SITE_ID = "siteId";
export const SITE_ID = process.env.NEXT_PUBLIC_SITE_ID || "affiscope";

export function getServerSiteId(): string {
  try {
    const c = cookies();
    return c.get(COOKIE_SITE_ID)?.value || SITE_ID;
  } catch {
    return SITE_ID;
  }
}
