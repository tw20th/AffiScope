const ENDPOINT =
  "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601";

export type RakutenItem = {
  itemName: string;
  itemPrice: number;
  itemUrl: string;
  affiliateUrl?: string;
  shopName?: string;
  mediumImageUrls?: Array<string | { imageUrl: string }>;
  smallImageUrls?: Array<string | { imageUrl: string }>;
  reviewAverage?: number;
  reviewCount?: number;
  genreId?: number | string;
  itemCode?: string; // 追加
  shopCode?: string; // 追加
  shopUrl?: string; // 追加
};

export type SearchParams = {
  keyword?: string;
  itemCode?: string; // shopCode:itemCode
  genreId?: number | string;
  hits?: number; // 1-30
  page?: number; // 1-100
  sort?: string; // +itemPrice, -itemPrice, -reviewCount など
  minPrice?: number;
  maxPrice?: number;
};

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function qs(obj: Record<string, any>) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
    )
    .join("&");
}

async function callRakuten(params: Record<string, any>, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${ENDPOINT}?${qs(params)}`;
  const res = await fetch(url, { signal: controller.signal });

  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Rakuten API error: ${res.status} ${text}`);
  }
  return (await res.json()) as {
    count: number;
    hits: number;
    page: number;
    Items: Array<any>;
  };
}

/** 429/5xx リトライ（指数バックオフ） */
async function callWithRetry(params: Record<string, any>, max = 4) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await callRakuten(params);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const status = Number(msg.match(/\b(\d{3})\b/)?.[1] || 0);
      const retriable = status === 0 || status === 429 || status >= 500;
      if (retriable && attempt < max) {
        const delay = Math.min(8000, 400 * 2 ** attempt + Math.random() * 300);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

/** 楽天市場商品検索API */
export async function searchItems(input: SearchParams) {
  const applicationId = getEnv("RAKUTEN_APP_ID");
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

  const params = {
    applicationId,
    affiliateId, // あると affiliateUrl が返る
    format: "json",
    formatVersion: 2,
    elements:
      // ← 安定キーを必ず含める
      "itemName,itemPrice,itemUrl,affiliateUrl,mediumImageUrls,smallImageUrls,shopName,reviewAverage,reviewCount,genreId,itemCode,shopCode,shopUrl",
    hits: Math.max(1, Math.min(30, Number(input.hits ?? 30))),
    page: Math.max(1, Math.min(100, Number(input.page ?? 1))),
    keyword: input.keyword,
    itemCode: input.itemCode,
    genreId: input.genreId,
    sort: input.sort,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
  };

  const json = await callWithRetry(params);

  // formatVersion=2 ではフラット
  const items: RakutenItem[] = Array.isArray(json.Items)
    ? json.Items.map((x: any) => (x && x.Item ? x.Item : x))
    : [];

  return { total: json.count, items };
}
