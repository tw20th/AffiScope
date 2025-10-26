"use client";

type Props = {
  asin: string;
  source: "amazon" | "rakuten" | "a8" | "other";
  href: string;
  children: React.ReactNode;
};

const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL; // 例: https://<region>-<project>.cloudfunctions.net/trackClick

export default function Outbound({ asin, source, href, children }: Props) {
  const onClick = () => {
    try {
      // ① GA4イベント（DebugView で "click_affiliate" として確認できる）
      if (typeof window !== "undefined" && typeof window.gtag === "function") {
        window.gtag("event", "click_affiliate", {
          item_id: asin,
          partner: source,
          destination: href,
          page_location: window.location.href,
        });
      }

      // ② 既存のサーバー集計（views インクリメント等）
      if (TRACK_URL) {
        const data = JSON.stringify({ asin, source });
        if ("sendBeacon" in navigator) {
          navigator.sendBeacon(TRACK_URL, data);
        } else {
          fetch(TRACK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: data,
            keepalive: true,
          });
        }
      }
    } catch {
      // noop
    }
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer nofollow sponsored noopener"
      onClick={onClick}
    >
      {children}
    </a>
  );
}
