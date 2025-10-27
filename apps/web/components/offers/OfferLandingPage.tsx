"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { fetchCollection } from "@/lib/firestore-rest"; // ← 修正
import Link from "next/link";

type Offer = {
  id: string;
  title: string;
  description?: string;
  images?: string[];
  creatives?: {
    type: "banner" | "text";
    href: string;
    imgSrc?: string;
    label?: string;
  }[];
  updatedAt?: number;
};

export default function OfferLandingPage({ siteId }: { siteId: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const q = {
        where: [
          ["siteIds", "array-contains", siteId],
          ["archived", "==", false],
        ],
        orderBy: ["updatedAt", "desc"],
        limit: 24,
      } as const;

      const res = await fetchCollection<Offer>("offers", q);
      setOffers(res);
      setLoading(false);
    })();
  }, [siteId]);

  if (loading) return <div className="p-6">読み込み中…</div>;

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">家電レンタル特集</h1>
        <p className="text-sm text-gray-600">
          単品30日〜、設置・回収込みのおすすめ案件をピックアップ
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {offers.map((o) => {
          const banner = o.creatives?.find((c) => c.type === "banner");
          const textCta = o.creatives?.find((c) => c.type === "text");
          const hero = banner?.imgSrc ?? o.images?.[0];
          const href = banner?.href ?? textCta?.href;

          return (
            <article
              key={o.id}
              className="rounded-2xl border p-4 shadow-sm hover:shadow"
            >
              {hero && href && (
                <a href={href} rel="nofollow sponsored" target="_blank">
                  <div className="relative w-full h-40 md:h-48 lg:h-56 mb-3">
                    <Image
                      src={hero}
                      alt={o.title}
                      fill
                      className="object-cover rounded-xl"
                      sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
                      priority={false}
                    />
                  </div>
                </a>
              )}
              <h3 className="font-semibold mb-1">{o.title}</h3>
              {o.description && (
                <p className="text-sm text-gray-600 line-clamp-3">
                  {o.description}
                </p>
              )}
              <div className="mt-3">
                {banner ? (
                  <a
                    href={banner.href}
                    rel="nofollow sponsored"
                    target="_blank"
                    className="inline-flex items-center rounded-xl border px-3 py-2 text-sm"
                  >
                    公式で詳しく見る
                  </a>
                ) : textCta ? (
                  <a
                    href={textCta.href}
                    rel="nofollow sponsored"
                    target="_blank"
                    className="underline text-sm"
                  >
                    {textCta.label ?? "公式で詳しく見る"}
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <aside className="text-xs text-gray-500">
        ※ 本ページは広告を含みます
      </aside>
    </main>
  );
}
