// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_SITE_ID = "siteId";
const DEFAULT_SITE_ID = "affiscope";

const HOST_TO_SITE: Record<string, string> = {
  "localhost:3000": "affiscope", // ローカルの既定。開発中は適宜 chairscope にしてOK
  "chairscope.com": "chairscope", // 本番
  "www.chairscope.com": "chairscope",
};

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";

  // 1) 開発用クエリ (?site=xxx) を最優先
  const siteFromQuery = url.searchParams.get("site")?.trim();

  // 2) 既存 Cookie を次に優先
  const siteFromCookie = req.cookies.get(COOKIE_SITE_ID)?.value?.trim();

  // 3) 本番などは Host マッピングを最後に
  const siteFromHost = HOST_TO_SITE[host];

  const siteId =
    siteFromQuery || siteFromCookie || siteFromHost || DEFAULT_SITE_ID;

  // クエリで来た場合はURLから?site=を取り除きつつ、Cookie/ヘッダを付与してリダイレクト
  if (siteFromQuery) {
    url.searchParams.delete("site");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE_SITE_ID, siteId, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
    });
    res.headers.set("x-site-id", siteId);
    return res;
  }

  // 通常レスポンス：Cookie/ヘッダを常に最新化
  const res = NextResponse.next();
  res.cookies.set(COOKIE_SITE_ID, siteId, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
  res.headers.set("x-site-id", siteId);
  return res;
}

export const config = { matcher: "/:path*" };
