"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { fetchCollection } from "@/lib/firestore-rest";

type Creative = {
  type: "banner" | "text";
  href: string;
  imgSrc?: string;
  label?: string;
};

type Offer = {
  id: string;
  title: string;
  description?: string;
  images?: string[];
  creatives?: Creative[];
  updatedAt?: number;
};

export default function OfferGallery(props: {
  siteId: string;
  variant?: "grid" | "list" | "hero";
  limit?: number;
}) {
  const { siteId, variant = "grid", limit = 24 } = props;
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const where: any[] = [
        ["siteIds", "array-contains", siteId],
        ["archived", "==", false],
      ];
      const orderBy: any = ["updatedAt", "desc"]; // 互換形式
      const res = await fetchCollection<Offer>("offers", {
        where,
        orderBy,
        limit,
      });
      setOffers(res);
      setLoading(false);
    })();
  }, [siteId, limit]);

  if (loading) return <div className="p-6">読み込み中…</div>;
  if (!offers.length)
    return <div className="p-6">掲載中の案件がありません。</div>;

  // レンダラー（CTA優先: banner→text）
  const renderCTA = (o: Offer) => {
    const banner = o.creatives?.find((c) => c.type === "banner");
    const text = o.creatives?.find((c) => c.type === "text");
    if (banner?.href) {
      return (
        <a
          href={banner.href}
          rel="nofollow sponsored"
          target="_blank"
          className="inline-flex items-center rounded-xl border px-3 py-2 text-sm"
        >
          公式で詳しく見る
        </a>
      );
    }
    if (text?.href) {
      return (
        <a
          href={text.href}
          rel="nofollow sponsored"
          target="_blank"
          className="underline text-sm"
        >
          {text.label ?? "公式で詳しく見る"}
        </a>
      );
    }
    return null;
  };

  const Card = ({ o }: { o: Offer }) => {
    const banner = o.creatives?.find((c) => c.type === "banner");
    const text = o.creatives?.find((c) => c.type === "text");
    const hero = banner?.imgSrc ?? o.images?.[0];

    return (
      <article className="rounded-2xl border p-4 shadow-sm hover:shadow transition">
        {hero && (banner?.href || text?.href) ? (
          <a
            href={(banner?.href ?? text?.href)!}
            rel="nofollow sponsored"
            target="_blank"
          >
            <Image
              src={hero}
              alt={o.title}
              width={600}
              height={400}
              className="w-full rounded-xl mb-3 h-auto"
            />
          </a>
        ) : hero ? (
          <Image
            src={hero}
            alt={o.title}
            width={600}
            height={400}
            className="w-full rounded-xl mb-3 h-auto"
          />
        ) : null}

        <h3 className="font-semibold mb-1">{o.title}</h3>
        {o.description && (
          <p className="text-sm text-gray-600 line-clamp-3">{o.description}</p>
        )}
        <div className="mt-3">{renderCTA(o)}</div>
      </article>
    );
  };

  if (variant === "list") {
    return (
      <section className="mx-auto max-w-4xl p-6 space-y-5">
        <header className="mb-2">
          <h1 className="text-xl font-bold">家電レンタル特集</h1>
          <p className="text-xs text-gray-500">※ 本ページは広告を含みます</p>
        </header>

        {offers.map((o) => {
          const banner = o.creatives?.find((c) => c.type === "banner");
          const text = o.creatives?.find((c) => c.type === "text");
          const hero = banner?.imgSrc ?? o.images?.[0];
          return (
            <div key={o.id} className="flex gap-4 rounded-2xl border p-4">
              {hero && (
                <div className="w-40 shrink-0">
                  {banner?.href || text?.href ? (
                    <a
                      href={(banner?.href ?? text?.href)!}
                      rel="nofollow sponsored"
                      target="_blank"
                    >
                      <Image
                        src={hero}
                        alt={o.title}
                        width={320}
                        height={200}
                        className="rounded-lg h-auto"
                      />
                    </a>
                  ) : (
                    <Image
                      src={hero}
                      alt={o.title}
                      width={320}
                      height={200}
                      className="rounded-lg h-auto"
                    />
                  )}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="font-semibold text-base">{o.title}</h3>
                {o.description && (
                  <p className="mt-1 text-sm text-gray-600">{o.description}</p>
                )}
                <div className="mt-2">{renderCTA(o)}</div>
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  if (variant === "hero") {
    const [first, ...rest] = offers;
    return (
      <main className="mx-auto max-w-6xl p-6 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">家電レンタルおすすめ</h1>
          <p className="text-sm text-gray-600">※ 本ページは広告を含みます</p>
        </header>

        {/* HERO */}
        <section className="rounded-3xl border p-6 md:p-8 shadow-sm">
          <Card o={first} />
        </section>

        {/* Others */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {rest.map((o) => (
            <Card key={o.id} o={o} />
          ))}
        </section>
      </main>
    );
  }

  // default: grid
  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">家電レンタル特集</h1>
        <p className="text-sm text-gray-600">※ 本ページは広告を含みます</p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {offers.map((o) => (
          <Card key={o.id} o={o} />
        ))}
      </section>
    </main>
  );
}
