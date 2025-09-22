// apps/web/lib/site-server.ts
import { headers, cookies } from "next/headers";

export const COOKIE_SITE_ID = "siteId";
export const DEFAULT_SITE_ID = process.env.NEXT_PUBLIC_SITE_ID || "affiscope";

export function getServerSiteId(): string {
  try {
    const h = headers();
    const fromHeader = h.get("x-site-id");
    if (fromHeader) return fromHeader;

    const c = cookies();
    return c.get(COOKIE_SITE_ID)?.value || DEFAULT_SITE_ID;
  } catch {
    return DEFAULT_SITE_ID;
  }
}

// --- サイト設定の取得（Firestore REST） ---
type SiteConfig = {
  siteId: string;
  displayName?: string;
  brand?: { primary?: string; accent?: string; logoUrl?: string };
  categoryPreset?: string[];
  [k: string]: unknown;
};

export async function loadSiteConfig(siteId: string): Promise<SiteConfig> {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID!;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY!;
  if (!projectId || !apiKey) {
    throw new Error("FB env missing");
  }

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sites/${encodeURIComponent(
      siteId
    )}`
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    // 404/403 はここに来る → 呼び出し側で catch してデフォルトに
    throw new Error(`fetch site failed: ${res.status}`);
  }
  const json = (await res.json()) as any;

  // Firestore REST の値 → 普通のオブジェクトへ
  const fields = json.fields ?? {};
  const get = (k: string) => fields[k];
  const str = (k: string) => get(k)?.stringValue as string | undefined;
  const arr = (k: string) =>
    (get(k)?.arrayValue?.values ?? []).map((v: any) => v.stringValue as string);

  const brand = get("brand")?.mapValue?.fields ?? {};
  const brandStr = (k: string) => brand[k]?.stringValue as string | undefined;

  return {
    siteId,
    displayName: str("displayName") ?? "AffiScope",
    brand: {
      primary: brandStr("primary"),
      accent: brandStr("accent"),
      logoUrl: brandStr("logoUrl"),
    },
    categoryPreset: arr("categoryPreset") ?? [],
  };
}
