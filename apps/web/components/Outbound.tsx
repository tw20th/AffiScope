"use client";

type Props = {
  asin: string;
  source: "amazon" | "rakuten";
  href: string;
  children: React.ReactNode;
};

const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL; // 例: https://<region>-<project>.cloudfunctions.net/trackClick

export default function Outbound({ asin, source, href, children }: Props) {
  const onClick = () => {
    try {
      if (TRACK_URL) {
        const data = JSON.stringify({ asin, source });
        if ("sendBeacon" in navigator) {
          navigator.sendBeacon(TRACK_URL, data);
        } else {
          fetch(TRACK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: data,
          });
        }
      }
    } catch {}
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
