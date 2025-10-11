// apps/web/app/layout.tsx
import "./globals.css";
import SiteHeader from "@/components/common/SiteHeader";
import SiteFooter from "@/components/common/SiteFooter";
import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/site-config";
import Script from "next/script";
import Analytics from "./Analytics";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfig();
  const title = { default: site.title, template: `%s | ${site.title}` };
  const description = site.description;

  return {
    metadataBase: new URL(site.urlOrigin),
    title,
    description,
    openGraph: {
      type: "website",
      siteName: site.title,
      url: site.urlOrigin,
      images: [{ url: "/og-default.png" }],
    },
    twitter: { card: "summary_large_image" },
    themeColor: site.brandColor,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = getSiteConfig();
  // site-config 側に追加する analytics フィールドを参照
  const GA_MEASUREMENT_ID = site.analytics?.ga4MeasurementId || "";

  return (
    <html lang="ja" data-site={site.siteId} data-theme={site.theme}>
      <head>
        {/* ---- GA4（サイト別に切替） ---- */}
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
      </head>
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">
        {/* ルート遷移の page_view */}
        <Analytics measurementId={GA_MEASUREMENT_ID} />

        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
