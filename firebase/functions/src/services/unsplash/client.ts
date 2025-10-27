// firebase/functions/src/services/unsplash/client.ts
type Hero = { url: string; credit?: string; creditLink?: string };

function buildQueries(raw: string) {
  const s = (raw || "").trim();
  // よく刺さる順に複数クエリを試す
  const list: string[] = [];

  // 元の全文（まずは一発）
  if (s) list.push(s);

  // 日本語のキーワード抽出（ゆるめ）
  const jp = s
    .replace(/[『』【】｜|]/g, " ")
    .replace(/[^a-zA-Z0-9\u3040-\u30ff\u4e00-\u9faf ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  // 代表ワードがあれば短縮版
  const jpFocus = jp.filter((w) =>
    /(家電|冷蔵庫|洗濯機|電子レンジ|レンタル|サブスク)/.test(w)
  );
  if (jpFocus.length) list.push(jpFocus.join(" "));

  // 英語フォールバック（家電レンタル系）
  list.push(
    "home appliances",
    "kitchen appliances",
    "living room interior",
    "appliance store",
    "electronics",
    "appliance rental"
  );

  // 重複除去
  return Array.from(new Set(list)).slice(0, 8);
}

export async function findUnsplashHero(query: string): Promise<Hero | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  const queries = buildQueries(query);

  for (const q of queries) {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", q);
    url.searchParams.set("per_page", "5"); // 5枚取って最初を採用
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("content_filter", "high");
    url.searchParams.set("order_by", "relevant");

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Client-ID ${key}`,
        "Accept-Version": "v1",
      },
    });

    if (!resp.ok) {
      // 403/429などは次のクエリを試す（必要ならここで break してもよい）
      try {
        const t = await resp.text();
        console.warn("[unsplash]", resp.status, t.slice(0, 200));
      } catch {}
      continue;
    }

    const data = await resp.json().catch(() => null);
    const first = data?.results?.[0];
    if (!first) continue;

    const urlPick =
      first.urls?.regular ||
      first.urls?.full ||
      first.urls?.small ||
      first.urls?.raw;
    if (!urlPick) continue;

    const credit = first.user?.name || undefined;
    const creditLink =
      first.links?.html || first.user?.links?.html || undefined;

    return { url: urlPick, credit, creditLink };
  }

  return null;
}
