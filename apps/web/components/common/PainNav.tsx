"use client";
import Link from "next/link";

export type PainItem = {
  id: string;
  label: string;
  tags: string[]; // 先頭を優先して /products?tag=... へ飛ばす
  icon?: string;
};

type Props = { items: PainItem[]; className?: string };

export default function PainNav({ items, className }: Props) {
  if (!items?.length) return null;

  return (
    <section className={className}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">悩みから選ぶ</h2>
        <span className="text-xs opacity-60">状況に合う商品へ最短導線</span>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((p) => {
          const tag = p.tags[0] ?? "";
          const href = tag
            ? `/products?tag=${encodeURIComponent(tag)}`
            : "/products";
          return (
            <li key={p.id}>
              <Link
                href={href}
                className="group block rounded-xl border p-4 transition hover:shadow-sm focus:outline-none focus:ring"
                aria-label={`${p.label} を解決する商品へ`}
              >
                <div className="mb-1 text-lg">
                  {p.icon ? <span className="mr-1">{p.icon}</span> : null}
                  <span className="font-medium">{p.label}</span>
                </div>
                <p className="text-xs opacity-60 group-hover:opacity-80">
                  {tag ? `#${tag} の商品を見る` : "商品一覧へ"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
