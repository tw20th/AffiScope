import Link from "next/link";

export type BlogSummary = {
  slug: string;
  title: string;
  summary?: string;
  imageUrl?: string;
  updatedAt: number;
};

export default function BlogsSection({
  title,
  items,
}: {
  title: string;
  items: BlogSummary[];
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Link href="/blog" className="text-sm underline">
          一覧へ
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm opacity-70">
          公開済みのブログがありません。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {items.map((b) => (
            <li
              key={b.slug}
              className="rounded-xl border p-4 transition hover:shadow-sm"
            >
              <Link href={`/blog/${b.slug}`}>
                <div className="mb-1 line-clamp-2 text-base font-medium">
                  {b.title}
                </div>
                {b.summary && (
                  <p className="line-clamp-3 text-sm opacity-70">{b.summary}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
