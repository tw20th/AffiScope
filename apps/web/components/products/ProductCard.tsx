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

export default function ProductCard({ p }: { p: Product }) {
  const price = p.bestPrice?.price;
  const updatedAt = p.bestPrice?.updatedAt;

  return (
    <li className="group overflow-hidden rounded-2xl border bg-white transition hover:shadow-sm">
      <Link href={`/products/${p.asin}`} className="block">
        <div className="aspect-[4/3] bg-gray-50 relative">
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
        </div>

        <div className="p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span className="truncate">{p.brand ?? "ブランド不明"}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px]">
              広告
            </span>
          </div>

          <h3 className="mb-2 line-clamp-2 font-medium leading-snug">
            {p.title}
          </h3>

          {typeof price === "number" ? (
            <div className="mb-1 text-lg font-semibold">{jpy(price)}</div>
          ) : (
            <div className="mb-1 text-sm text-gray-500">価格を取得中です</div>
          )}

          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span>最終更新: {timeago(updatedAt)}</span>
            <span className="underline opacity-80 group-hover:opacity-100">
              詳細を見る
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
