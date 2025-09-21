// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const HOST_TO_SITE: Record<string, string> = {
  "localhost:3000": "affiscope", // dev
  // "mobattery.example.com": "mobattery",
  // "gchair.example.com": "gchair",
};

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const siteId = HOST_TO_SITE[host] ?? "affiscope";

  const res = NextResponse.next();
  // クライアント用（use client）に Cookie
  res.cookies.set("siteId", siteId, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
  // SSR/Edge 用に Header も付ける（Server Component で headers().get(...) 可能）
  res.headers.set("x-site-id", siteId);
  return res;
}

export const config = { matcher: "/:path*" };
