import { headers, cookies } from "next/headers";

export const COOKIE_SITE_ID = "siteId";

// 既定値を chairscope に（このプロジェクト前提）
export const DEFAULT_SITE_ID = process.env.NEXT_PUBLIC_SITE_ID ?? "chairscope";

export function getServerSiteId(): string {
  // 1) 明示ENVがあれば最優先
  if (process.env.NEXT_PUBLIC_SITE_ID) return process.env.NEXT_PUBLIC_SITE_ID;

  try {
    const h = headers();

    // 2) 逆プロキシ等からのヘッダ
    const fromHeader = h.get("x-site-id");
    if (fromHeader) return fromHeader;

    // 3) ホスト名で自動判定（保険）
    const host = h.get("host") ?? "";
    if (host.includes("chairscope")) return "chairscope";
    if (host.includes("affiscope")) return "affiscope";

    // 4) クッキー（必要なら）
    const c = cookies();
    return c.get(COOKIE_SITE_ID)?.value || DEFAULT_SITE_ID;
  } catch {
    return DEFAULT_SITE_ID;
  }
}
