import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { asin: string } }
) {
  const to = req.nextUrl.searchParams.get("to");
  if (!to) return NextResponse.json({ error: "missing to" }, { status: 400 });

  // fire-and-forget 計測呼び出し（エラーは握りつぶす）
  const fnBase = process.env.NEXT_PUBLIC_FUNCTION_BASE; // 例: https://asia-northeast1-<project>.cloudfunctions.net
  const src = req.nextUrl.searchParams.get("src") ?? "unknown";
  if (fnBase) {
    fetch(`${fnBase.replace(/\/$/, "")}/trackClick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asin: params.asin,
        to,
        src,
        ua: req.headers.get("user-agent"),
        ref: req.headers.get("referer"),
        ts: Date.now(),
      }),
    }).catch(() => {});
  }

  // 302 redirect
  return NextResponse.redirect(to, { status: 302 });
}
