import Link from "next/link";
import ProductCard from "@/components/products/ProductCard";
import type { Product } from "@affiscope/shared-types";

export default function FeaturedSection({
  title,
  items,
}: {
  title: string;
  items: Product[];
}) {
  return (
    <section className="mb-12">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Link href="/products" className="text-sm underline">
          すべて見る
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm opacity-70">
          まだ商品がありません。クローラや同期をお待ちください。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {items.map((p) => (
            <ProductCard key={p.asin} p={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
