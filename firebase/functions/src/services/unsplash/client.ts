// node-fetch は不要です
// import fetch from "node-fetch";

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";

export async function findUnsplashHero(query: string) {
  if (!UNSPLASH_ACCESS_KEY) return null;
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("orientation", "landscape");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
  });

  if (!resp.ok) return null;

  const json = (await resp.json()) as any;
  const item = json?.results?.[0];
  if (!item) return null;

  return {
    url: item.urls?.regular || item.urls?.full || "",
    credit: item.user?.name || "",
    creditLink: item.user?.links?.html || "",
  };
}
