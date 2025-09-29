"use client";

import Link from "next/link";
import Image from "next/image";
import { summaryFromContent } from "@/utils/text";

export type BlogCardProps = {
  slug: string;
  title: string;
  summary?: string | null;
  content?: string | null; // フォールバック用（任意）
  imageUrl?: string | null;
  updatedAt?: number | null;
};

export default function BlogCard({
  slug,
  title,
  summary,
  content,
  imageUrl,
  updatedAt,
}: BlogCardProps) {
  const fallback =
    !summary || summary.trim().length === 0
      ? summaryFromContent(content ?? "")
      : summary;

  return (
    <li className="flex gap-4 rounded-2xl border p-4">
      {imageUrl ? (
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-gray-50">
          {/* 画像は任意。外部ドメイン許可は next.config に合わせてね */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}

      <div className="min-w-0">
        <h2 className="text-lg font-semibold">
          <Link href={`/blog/${slug}`}>{title}</Link>
        </h2>
        {fallback ? (
          <p className="mt-1 text-sm text-gray-600 line-clamp-2">{fallback}</p>
        ) : null}
        <div className="mt-1 text-xs text-gray-500">
          {updatedAt ? new Date(updatedAt).toLocaleString("ja-JP") : ""}
        </div>
      </div>
    </li>
  );
}
