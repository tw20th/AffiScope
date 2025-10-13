// apps/web/app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import SiteHeader from "@/components/common/SiteHeader";
import SiteFooter from "@/components/common/SiteFooter";
import { getSiteConfig } from "@/lib/site-config";
import Analytics from "./Analytics";

export const dynamic = "force-dynamic";

// ✅ ここで viewport を定義（警告解消）
export const viewport = { themeColor: "#ffffff" };

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
    // ← ここからは themeColor を削除
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = getSiteConfig();
  const GA_MEASUREMENT_ID = site.analytics?.ga4MeasurementId || "";

  return (
    <html lang="ja" data-site={site.siteId} data-theme={site.theme}>
      <head>
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
                gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });

                try {
                  var usp = new URLSearchParams(window.location.search);
                  if (usp.get('ga_debug') === '1') {
                    gtag('set', 'debug_mode', true);
                    console.log('[GA4] debug_mode=ON (${GA_MEASUREMENT_ID})');
                  }
                } catch(e) {}
              `}
            </Script>
          </>
        )}
      </head>
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">
        <Analytics measurementId={GA_MEASUREMENT_ID} />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
