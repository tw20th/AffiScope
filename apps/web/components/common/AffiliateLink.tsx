// 例: apps/web/components/common/AffiliateLink.tsx
"use client";
import { gaEvent } from "@/lib/gtag";
import { useMemo } from "react";
import { getSiteConfig } from "@/lib/site-config"; // もしクライアントで使えない設計なら props で渡す

type Props = { href: string; label: string; className?: string };

export default function AffiliateLink({ href, label, className }: Props) {
  const measurementId = useMemo(
    () => getSiteConfig().analytics?.ga4MeasurementId || "",
    []
  );
  const onClick = () => {
    if (measurementId) {
      gaEvent(measurementId, "affiliate_click", {
        event_category: "Affiliate",
        event_label: label,
      });
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };
  return (
    <button onClick={onClick} className={className}>
      {label}
    </button>
  );
}
