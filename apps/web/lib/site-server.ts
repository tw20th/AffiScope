// apps/web/lib/site-server.ts
import { headers, cookies } from "next/headers";

export const COOKIE_SITE_ID = "siteId";

// ENV を最優先にします（←ここがポイント）
export const DEFAULT_SITE_ID = process.env.NEXT_PUBLIC_SITE_ID ?? "affiscope";

export function getServerSiteId(): string {
  try {
    const h = headers();
    const fromHeader = h.get("x-site-id");
    if (fromHeader) return fromHeader;

    // ENV があれば cookie より優先
    if (process.env.NEXT_PUBLIC_SITE_ID) {
      return process.env.NEXT_PUBLIC_SITE_ID;
    }

    const c = cookies();
    return c.get(COOKIE_SITE_ID)?.value || DEFAULT_SITE_ID;
  } catch {
    return DEFAULT_SITE_ID;
  }
}
