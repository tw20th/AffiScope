"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { productConverter } from "../../lib/converters";
import type { Product, Category } from "@affiscope/shared-types";
import { getSiteId } from "../../lib/site";
import {
  fetchCategoryBySlug,
  fetchBreadcrumbs,
  fetchSiblings,
} from "../../lib/categories";
import { formatJPY, formatDateTime } from "../../lib/format";
import Outbound from "../../components/Outbound";

type SP = { category?: string };

export default function ProductsPage({ searchParams }: { searchParams?: SP }) {
  const categorySlug = searchParams?.category ?? "mobile-battery";
  const siteId = getSiteId();

  const [items, setItems] = useState<Product[]>([]);
  const [currentCat, setCurrentCat] = useState<Category | undefined>(undefined);
  const [crumbs, setCrumbs] = useState<Category[]>([]);
  const [siblings, setSiblings] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const baseQuery = useMemo(
    () =>
      query(
        collection(db, "products").withConverter(productConverter),
        where("siteId", "==", siteId),
        where("categoryId", "==", categorySlug)
      ),
    [siteId, categorySlug]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // カテゴリ情報
        const cat = await fetchCategoryBySlug(db, siteId, categorySlug);
        const [bc, sib] = await Promise.all([
          fetchBreadcrumbs(db, siteId, cat),
          fetchSiblings(db, siteId, cat),
        ]);
        if (!cancelled) {
          setCurrentCat(cat);
          setCrumbs(bc);
          setSiblings(sib);
        }

        // 商品
        const snap = await getDocs(baseQuery);
        const rows = snap.docs.map((d) => d.data());
        rows.sort(
          (a, b) =>
            (a.bestPrice?.price ?? Number.POSITIVE_INFINITY) -
            (b.bestPrice?.price ?? Number.POSITIVE_INFINITY)
        );
        if (!cancelled) setItems(rows);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseQuery, siteId, categorySlug]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* パンくず */}
      <nav className="text-sm text-gray-500">
        <ol className="flex flex-wrap gap-1">
          <li>
            <a href="/products" className="underline">
              ホーム
            </a>
          </li>
          {crumbs.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1">
              <span>›</span>
              <a href={`/products?category=${c.slug}`} className="underline">
                {c.name}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <h1 className="mt-3 text-2xl font-bold">
        商品一覧（{currentCat?.name ?? categorySlug}）
      </h1>

      {/* 同階層カテゴリ */}
      {siblings.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {siblings.map((c) => (
            <li key={c.id}>
              <a
                href={`/products?category=${c.slug}`}
                className={`rounded-full border px-3 py-1 text-sm ${c.slug === categorySlug ? "bg-black text-white" : "bg-white"}`}
              >
                {c.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="mt-4 text-gray-500">読み込み中…</p>}
      {err && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          エラー: {err}
        </p>
      )}
      {!loading && !err && items.length === 0 && (
        <p className="mt-4 text-gray-500">該当商品がありません。</p>
      )}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <li key={p.asin} className="rounded-2xl border bg-white p-4">
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
                <p className="mt-2 text-lg font-bold">
                  {formatJPY(p.bestPrice.price)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {formatDateTime(p.bestPrice.updatedAt)}{" "}
                  時点の価格です（変動します）
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-500">価格情報なし</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              {p.offers?.map((o) => (
                <Outbound
                  key={o.url}
                  asin={p.asin}
                  source={o.source}
                  href={o.url}
                >
                  {o.source === "amazon" ? "Amazon" : "楽天"}
                </Outbound>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
