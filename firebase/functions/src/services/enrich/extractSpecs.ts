export type Enriched = {
  tags: string[];
  categoryId?: string;
  specs?: Record<string, any>;
};

/** タイトル文字列から数値系スペックを抜く簡易パーサ */
function extractNumbers(title: string) {
  const t = title;
  const mAh = /(\d{4,6})\s*mAh/iu.exec(t)?.[1];
  const Wh = /(\d{3,4})\s*Wh/iu.exec(t)?.[1];
  const Watt =
    /(\d{2,4})\s*W(?!h)/iu.exec(t)?.[1] ||
    /PD\s*([1-9]\d{1,3})\s*W/iu.exec(t)?.[1];

  return {
    mAh: mAh ? Number(mAh) : undefined,
    Wh: Wh ? Number(Wh) : undefined,
    Watt: Watt ? Number(Watt) : undefined,
  };
}

/** オーバーロード（既存の呼び出し互換：3引数 or オブジェクト1引数） */
export function enrichForSite(args: {
  siteId: string;
  title: string;
  categoryIdFallback: string;
}): Enriched;
export function enrichForSite(
  siteId: string,
  title: string,
  categoryIdFallback: string
): Enriched;

// 実装
export function enrichForSite(
  a: string | { siteId: string; title: string; categoryIdFallback: string },
  b?: string,
  c?: string
): Enriched {
  const input =
    typeof a === "string"
      ? { siteId: a, title: b ?? "", categoryIdFallback: c ?? "" }
      : a;

  const titleLower = input.title.toLowerCase();
  const tags = new Set<string>();
  let categoryId: string | undefined = input.categoryIdFallback;
  const specs: Record<string, any> = {};

  // サイトごとの簡易ルール
  if (input.siteId === "powerbank-scope") {
    categoryId = "power-bank";
    const nums = extractNumbers(input.title);
    if (nums.mAh) specs.capacity_mAh = nums.mAh;
    if (nums.Watt) specs.maxOutputW = nums.Watt;
    if (/mag\s*saf(e)?/iu.test(titleLower)) tags.add("MagSafe対応");
    if (/(薄型|スリム)/u.test(input.title)) tags.add("薄型");
    if (/(軽量|\b1?\d{2}g\b)/u.test(input.title)) tags.add("軽量");
    if (/機内持(込|ち)み|飛行機|100Wh/iu.test(input.title))
      tags.add("機内持込可");
    if (/(PD|Power\s*Delivery|急速)/iu.test(input.title)) tags.add("急速充電");
  } else if (input.siteId === "powerscope") {
    categoryId = "portable-power";
    const nums = extractNumbers(input.title);
    if (nums.Wh) specs.capacity_Wh = nums.Wh;
    if (nums.Watt) specs.acOutputW = nums.Watt;
    if (/(リン酸鉄|LiFePO4|LFP)/iu.test(input.title)) tags.add("LFP");
    if (/(ソーラー|MPPT|PV)/iu.test(input.title)) tags.add("ソーラー対応");
    if (/(静音|低騒音)/u.test(input.title)) tags.add("静音");
  } else if (input.siteId === "chairscope") {
    categoryId = "gaming-chair";
    if (/(メッシュ|通気)/u.test(input.title)) tags.add("蒸れ対策");
    if (/(腰|ランバー)/u.test(input.title)) tags.add("腰痛対策");
    if (/(オットマン|フットレスト)/u.test(input.title)) tags.add("オットマン");
  }

  return {
    categoryId,
    tags: Array.from(tags),
    specs,
  };
}
