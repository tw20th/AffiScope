import { NextResponse } from "next/server";
import { coerceSiteId } from "@/lib/site-catalog";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const want = url.searchParams.get("siteId") || undefined;
  const resolved = coerceSiteId(
    want,
    url.host,
    process.env.NEXT_PUBLIC_SITE_ID
  );
  const res = NextResponse.redirect(new URL("/", url));
  res.cookies.set("siteId", resolved, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
