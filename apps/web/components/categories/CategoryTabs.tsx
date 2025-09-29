// apps/web/components/categories/CategoryTabs.tsx
"use client";

import Link from "next/link";

export type CategoryTab = {
  id: string;
  name: string;
  slug: string;
};

export default function CategoryTabs({
  categories,
  activeSlug,
}: {
  categories: CategoryTab[];
  activeSlug?: string;
}) {
  if (!categories?.length) return null;

  return (
    <ul className="mt-3 mb-4 flex flex-wrap gap-2">
      {categories.map((c) => {
        const isActive = c.slug === activeSlug;
        return (
          <li key={c.id}>
            <Link
              href={`/products?category=${encodeURIComponent(c.slug)}`}
              className={[
                "rounded-full border px-3 py-1 text-sm transition",
                isActive ? "bg-black text-white" : "bg-white hover:bg-gray-50",
              ].join(" ")}
            >
              {c.name}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
