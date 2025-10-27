import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { coerceSiteId } from "@/lib/site-catalog";

export async function GET() {
  const ck = cookies().get("siteId")?.value ?? null;
  const host = headers().get("host");
  const resolved = coerceSiteId(
    ck ?? undefined,
    host,
    process.env.NEXT_PUBLIC_SITE_ID
  );
  return NextResponse.json({ cookie: ck, host, resolved });
}
