// apps/web/components/products/ProductCard.tsx
import type { Product } from "@affiscope/shared-types";

const jpy = (n?: number) =>
  typeof n === "number"
    ? new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
      }).format(n)
    : "";

const fmt = (ts?: number) =>
  typeof ts === "number" ? new Date(ts).toLocaleString("ja-JP") : "";

export default function ProductCard({ p }: { p: Product }) {
  return (
    <li className="rounded-2xl border bg-white p-4 hover:shadow-sm transition">
      {p.imageUrl ? (
        <img
          src={p.imageUrl}
          alt={p.title}
          className="h-40 w-full rounded-xl object-contain"
          loading="lazy"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
          no image
        </div>
      )}

      <h2 className="mt-2 line-clamp-2 font-semibold">{p.title}</h2>
      {p.brand && <p className="mt-1 text-sm text-gray-500">{p.brand}</p>}

      {p.bestPrice ? (
        <>
          <p className="mt-2 text-lg font-bold">{jpy(p.bestPrice.price)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {fmt(p.bestPrice.updatedAt)} 時点の価格です（変動します）
          </p>
          <div className="mt-2">
            <a
              href={p.bestPrice.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-3 py-1 text-sm underline"
            >
              最安をチェック（
              {p.bestPrice.source === "amazon" ? "Amazon" : "楽天"}）
            </a>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-500">価格情報なし</p>
      )}
    </li>
  );
}
