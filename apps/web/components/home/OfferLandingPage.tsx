// apps/web/components/home/OfferLandingPage.tsx （kariraku用デザイン例）
export default function OfferLandingPage({ site }: { site: any }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <section className="mb-12 text-center">
        <h1 className="text-4xl font-bold text-emerald-600">
          {site.homeCopy?.title}
        </h1>
        <p className="mt-3 text-slate-600 text-lg">{site.homeCopy?.subtitle}</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 後で Firestore の offers を動的表示 */}
        {[1, 2, 3].map((i) => (
          <article
            key={i}
            className="rounded-2xl border p-5 shadow-sm bg-white hover:shadow-md transition"
          >
            <div className="aspect-[16/9] bg-slate-100 rounded-lg" />
            <h3 className="mt-4 font-semibold text-lg">
              家電レンタル サンプル {i}
            </h3>
            <p className="text-sm text-slate-500">
              冷蔵庫・洗濯機などを“借りて暮らす”新しい選択。
            </p>
            <a
              href="/blog"
              className="mt-3 inline-block rounded-xl bg-emerald-500 text-white px-4 py-1.5 text-sm hover:bg-emerald-600 transition"
            >
              記事を見る →
            </a>
          </article>
        ))}
      </section>

      <footer className="mt-16 text-center text-slate-500 text-sm">
        <p>{site.homeCopy?.note}</p>
      </footer>
    </main>
  );
}
