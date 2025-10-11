// apps/web/components/common/SiteHeader.tsx
import Link from "next/link";
import { getSiteEntry } from "@/lib/site-server";

export default function SiteHeader() {
  const s = getSiteEntry(); // サーバー専用OK
  const siteName = s.displayName;

  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold tracking-tight">
          {siteName}
        </Link>
        <nav className="text-sm">
          <ul className="flex items-center gap-5">
            <li>
              <Link href="/products" className="hover:underline">
                商品一覧
              </Link>
            </li>
            <li>
              <Link href="/blog" className="hover:underline">
                ブログ
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
