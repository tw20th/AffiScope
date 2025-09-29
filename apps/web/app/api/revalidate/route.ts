import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const token = process.env.REVALIDATE_TOKEN;

    if (!token || secret !== token) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { path } = await req.json();
    if (typeof path !== "string" || !path.startsWith("/")) {
      return NextResponse.json(
        { ok: false, error: "Invalid path" },
        { status: 400 }
      );
    }

    revalidatePath(path);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
