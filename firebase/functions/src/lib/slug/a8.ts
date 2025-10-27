// 外部依存なしのユーティリティ

/** Firestore の docPath / URL に安全な文字へ */
function safe(input: string): string {
  return (
    (input || "")
      .toLowerCase()
      // 日本語は残しつつ、その他をハイフン化
      .replace(
        /[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\-_.~]+/giu,
        "-"
      )
      .replace(/-+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

/** yyyyMMdd 文字列を返す（JSTでもUTCでも差は実運用で問題なし） */
function formatYmd(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** A8系ブログ用の一意slug: a8-<siteId>-<offerId>-<YYYYMMDD>[-title40] */
export function a8BlogSlug(
  siteId: string,
  offerId: string,
  title?: string,
  ts?: number
) {
  const ymd = formatYmd(ts);
  const base = `a8-${safe(siteId)}-${safe(offerId)}-${ymd}`;
  if (title) {
    const tail = safe(title).slice(0, 40);
    if (tail) return `${base}-${tail}`;
  }
  return base;
}
