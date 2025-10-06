"use client";

import Link from "next/link";
import { summaryFromContent } from "@/utils/text";

export type BlogCardProps = {
  slug: string;
  title: string;
  summary?: string | null;
  content?: string | null; // フォールバック用（任意）
  imageUrl?: string | null;
  /** 追加: 公開日時（なければ updatedAt を出す） */
  publishedAt?: number | null;
  updatedAt?: number | null;
};

export default function BlogCard({
  slug,
  title,
  summary,
  content,
  imageUrl,
  publishedAt,
  updatedAt,
}: BlogCardProps) {
  const fallback =
    !summary || summary.trim().length === 0
      ? summaryFromContent(content ?? "")
      : summary;

  const pub = publishedAt ?? updatedAt ?? null;
  const upd = updatedAt ?? null;

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <li className="flex gap-4 rounded-2xl border p-4">
      {imageUrl ? (
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}

      <div className="min-w-0">
        <h2 className="text-lg font-semibold">
          <Link href={`/blog/${slug}`}>{title}</Link>
        </h2>

        {fallback ? (
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">{fallback}</p>
        ) : null}

        <div className="mt-1 text-xs text-gray-500">
          {pub ? <>公開: {fmt(pub)}</> : null}
          {upd && pub && upd > pub ? <>（更新: {fmt(upd)}）</> : null}
        </div>
      </div>
    </li>
  );
}
