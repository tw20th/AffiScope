// apps/web/app/Analytics.tsx
"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

type Props = { measurementId?: string };

/**
 * GA4 送信（App Router）
 * - 初回は gtag 読み込みが遅れる可能性があるため、短時間リトライして必ず1本送る
 * - ルート遷移ごとに page_path を更新して送る
 */
export default function Analytics({ measurementId }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!measurementId) return;

    const page_path =
      pathname + (searchParams?.toString() ? `?${searchParams}` : "");

    let canceled = false;
    let tries = 0;

    const send = () => {
      if (canceled) return;
      if (typeof window !== "undefined" && typeof window.gtag === "function") {
        // 送信（App Routerは config でOK）
        window.gtag("config", measurementId, { page_path });
        if (process.env.NODE_ENV !== "production") {
          console.log("[GA4] sent page_view via config", {
            measurementId,
            page_path,
          });
        }
        return;
      }
      // gtag がまだ無い → 150ms 間隔で最大 ~3秒リトライ
      if (tries < 20) {
        tries++;
        setTimeout(send, 150);
      } else if (process.env.NODE_ENV !== "production") {
        console.warn("[GA4] gtag not ready, gave up sending page_view");
      }
    };

    send();
    return () => {
      canceled = true;
    };
  }, [measurementId, pathname, searchParams]);

  // 開発用ログ（どのID/パスで動いているか見える化）
  useEffect(() => {
    if (!measurementId) return;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[GA4] siteId=%s, measurementId=%s, path=%s",
        document?.documentElement?.getAttribute("data-site"),
        measurementId,
        pathname + (searchParams?.toString() ? `?${searchParams}` : "")
      );
    }
  }, [measurementId, pathname, searchParams]);

  return null;
}
