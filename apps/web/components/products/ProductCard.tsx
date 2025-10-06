import Link from "next/link";
import Image from "next/image";
import type { Product } from "@affiscope/shared-types";

const jpy = (n?: number) =>
  typeof n === "number"
    ? new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
      }).format(n)
    : "";

const timeago = (ts?: number) => {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
};

// /out/:asin に変換（計測 src 区別用）
const outUrl = (p: Product, src: string) => {
  const raw = p.bestPrice?.url ?? p.affiliateUrl ?? p.url;
  return raw
    ? `/out/${encodeURIComponent(p.asin)}?to=${encodeURIComponent(
        raw
      )}&src=${src}`
    : undefined;
};

export default function ProductCard({ p }: { p: Product }) {
  const price = p.bestPrice?.price;
  const updatedAt = p.bestPrice?.updatedAt;

  return (
    <li className="overflow-hidden rounded-2xl border bg-white transition hover:shadow-sm">
      {/* 画像は個別にLink（a入れ子を避ける） */}
      <Link href={`/products/${p.asin}`} className="block">
        <div className="relative aspect-[4/3] bg-gray-50">
          {p.imageUrl ? (
            <Image
              src={p.imageUrl}
              alt={p.title}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover"
              priority={false}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs text-gray-400">
              画像なし
            </div>
          )}

          {p.inStock !== undefined && (
            <span
              className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                p.inStock
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {p.inStock ? "在庫あり" : "在庫なし"}
            </span>
          )}
        </div>
      </Link>

      <div className="p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span className="truncate">{p.brand ?? "ブランド不明"}</span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px]">
            広告
          </span>
        </div>

        {/* タイトルも個別にLink */}
        <Link href={`/products/${p.asin}`} className="block">
          <h3 className="mb-2 line-clamp-2 font-medium leading-snug">
            {p.title}
          </h3>
        </Link>

        {typeof price === "number" ? (
          <div className="mb-1 text-lg font-semibold">{jpy(price)}</div>
        ) : (
          <div className="mb-1 text-sm text-gray-500">価格を取得中です</div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-gray-500">
            最終更新: {timeago(updatedAt)}
          </span>

          {/* 購入ボタンは Link ではなく独立した <a>（外部遷移） */}
          {outUrl(p, "list") ? (
            <a
              href={outUrl(p, "list")}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="rounded-lg border px-2.5 py-1 text-xs font-medium hover:shadow-sm"
            >
              購入ページへ
            </a>
          ) : (
            <span className="text-[11px] text-gray-400">リンク準備中</span>
          )}
        </div>
      </div>
    </li>
  );
}
