// apps/web/components/pain/PainRail.tsx
import { getServerSiteId } from "@/lib/site-server";
import PainButtonsGrid from "./PainButtonsGrid";
import { decodePainRules, type PainRuleLite } from "@/lib/pain-rules";

// PainRule をサイト設定の personas 付きに拡張
type PainRuleEx = PainRuleLite & { personas?: string[] };

/** Firestore REST から sites/{siteId} を取得し、サイト設定を抽出 */
async function fetchSiteDoc(siteId: string): Promise<{
  brand?: {
    primary?: string;
    accent?: string;
    logoUrl?: string;
    theme?: "light" | "dark";
  };
  homeCopy?: {
    title?: string;
    subtitle?: string;
    featuredTitle?: string;
    blogsTitle?: string;
  };
  defaultPersona?: string;
  painRules: PainRuleEx[];
}> {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY;
  if (!projectId || !apiKey) return { painRules: [] };

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sites/${encodeURIComponent(
      siteId
    )}`
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return { painRules: [] };

  const json = (await res.json()) as
    | { fields?: Record<string, unknown> }
    | undefined;
  const fields = json?.fields ?? {};

  // --- helper
  const map = (m?: any) =>
    m && typeof m === "object" ? m.mapValue?.fields ?? {} : {};
  const s = (m: any, k: string) =>
    (map(m)[k]?.stringValue as string | undefined) ?? undefined;
  const arr = (m: any, k: string) =>
    ((map(m)[k]?.arrayValue?.values ?? []) as any[])
      .map((v) => v?.stringValue)
      .filter(Boolean) as string[];

  const brand = fields["brand"];
  const homeCopy = fields["homeCopy"];

  // painRules は decodePainRules が map 全体から抽出
  const painRulesRaw = decodePainRules(fields) ?? [];

  // personas を sites の painRules[] から拾う
  const prMap = (fields["painRules"] as any)?.arrayValue?.values ?? [];
  const personasById: Record<string, string[]> = {};
  for (const v of prMap) {
    const f = v?.mapValue?.fields ?? {};
    const id = f.id?.stringValue as string | undefined;
    const personas =
      (f.personas?.arrayValue?.values ?? [])
        .map((x: any) => x?.stringValue)
        .filter(Boolean) ?? [];
    if (id && personas.length) personasById[id] = personas;
  }

  const painRules: PainRuleEx[] = painRulesRaw.map((r) => ({
    ...r,
    personas: personasById[r.id] ?? [],
  }));

  return {
    brand: brand
      ? {
          primary: s(brand, "primary"),
          accent: s(brand, "accent"),
          logoUrl: s(brand, "logoUrl"),
          theme:
            (s(brand, "theme") as "light" | "dark" | undefined) ?? undefined,
        }
      : undefined,
    homeCopy: homeCopy
      ? {
          title: s(homeCopy, "title"),
          subtitle: s(homeCopy, "subtitle"),
          featuredTitle: s(homeCopy, "featuredTitle"),
          blogsTitle: s(homeCopy, "blogsTitle"),
        }
      : undefined,
    defaultPersona:
      (fields["defaultPersona"] as { stringValue?: string } | undefined)
        ?.stringValue ?? undefined,
    painRules,
  };
}

/**
 * サイト設定に応じて「悩み解決ボタン」を並べるサーバーコンポーネント。
 * 使い方: <PainRail className="my-10" />
 */
export default async function PainRail({ className }: { className?: string }) {
  const siteId = getServerSiteId();
  const site = await fetchSiteDoc(siteId);

  const rules: PainRuleEx[] = site.painRules ?? [];
  const brand = site.brand;

  const title =
    site.homeCopy?.featuredTitle ?? site.homeCopy?.title ?? "悩みから選ぶ";

  const subtitle = site.defaultPersona
    ? `${site.defaultPersona}向けのおすすめを素早く見つける`
    : "状況に合う商品へ最短導線";

  return (
    <PainButtonsGrid
      className={className}
      rules={rules}
      brand={brand}
      title={title}
      subtitle={subtitle}
      hrefBase="/pain"
    />
  );
}
