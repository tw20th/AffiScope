// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_SITE_ID = "siteId";
const DEFAULT_SITE_ID = "chairscope"; // ← 実在する siteId に
const HOST_TO_SITE: Record<string, string> = {
  localhost: "chairscope",
  "localhost:3000": "chairscope",
  "chairscope.com": "chairscope",
  "www.chairscope.com": "chairscope",
};

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";

  const siteFromQuery = url.searchParams.get("site")?.trim();
  const siteFromCookie = req.cookies.get(COOKIE_SITE_ID)?.value?.trim();
  const siteFromHost = HOST_TO_SITE[host];

  const siteId =
    siteFromQuery || siteFromCookie || siteFromHost || DEFAULT_SITE_ID;

  // ★ 同一リクエストにヘッダを“注入”してサーバー側で読めるようにする
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-site-id", siteId);

  if (siteFromQuery) {
    // ?site=... のときはリダイレクトしてURLを綺麗に
    url.searchParams.delete("site");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE_SITE_ID, siteId, { path: "/", sameSite: "lax" });
    // （レスポンス側にも一応残す）
    res.headers.set("x-site-id", siteId);
    return res;
  }

  // 通常レスポンス：Cookieを更新しつつ、リクエストヘッダを上書きして forward
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.cookies.set(COOKIE_SITE_ID, siteId, { path: "/", sameSite: "lax" });
  res.headers.set("x-site-id", siteId);
  return res;
}

export const config = { matcher: "/:path*" };
