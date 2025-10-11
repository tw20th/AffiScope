// apps/web/app/Analytics.tsx
"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pageview } from "@/lib/gtag";

type Props = { measurementId?: string };

export default function Analytics({ measurementId }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!measurementId) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : "");
    pageview(measurementId, url);
  }, [measurementId, pathname, searchParams]);

  return null;
}
