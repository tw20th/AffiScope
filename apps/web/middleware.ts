// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_SITE_ID = "siteId";
const DEFAULT_SITE_ID = "chairscope";
const ALLOWED = new Set(["chairscope", "powerscope", "powerbank-scope"]);

const HOST_TO_SITE: Record<string, string> = {
  "www.chairscope.com": "chairscope",
  "chairscope.com": "chairscope",
  "powerscope-lab.com": "powerscope",
  "www.powerscope-lab.com": "powerscope",
  "rakuten-bloggen1.com": "powerbank-scope",
  "www.rakuten-bloggen1.com": "powerbank-scope",
  "kariraku.com": "kariraku",
  "www.kariraku.com": "kariraku",

  localhost: "kariraku",
  "localhost:3000": "kariraku",
};

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const host = (req.headers.get("host") || "").toLowerCase();

  const q = url.searchParams.get("site")?.trim();
  const c = req.cookies.get(COOKIE_SITE_ID)?.value?.trim();
  const h = HOST_TO_SITE[host];

  // 優先順: ?site > host > cookie > default
  let siteId = q || h || c || DEFAULT_SITE_ID;
  if (!ALLOWED.has(siteId)) siteId = DEFAULT_SITE_ID; // ★不正値ガード

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-site-id", siteId);

  if (q) {
    url.searchParams.delete("site");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE_SITE_ID, siteId, { path: "/", sameSite: "lax" });
    res.headers.set("x-site-id", siteId);
    return res;
  }

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.cookies.set(COOKIE_SITE_ID, siteId, { path: "/", sameSite: "lax" });
  res.headers.set("x-site-id", siteId);
  return res;
}

export const config = { matcher: "/:path*" };
