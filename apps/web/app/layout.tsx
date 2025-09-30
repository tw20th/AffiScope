import "./globals.css";
import SiteHeader from "@/components/common/SiteHeader";
import SiteFooter from "@/components/common/SiteFooter";

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.chairscope.com"
  ),
  title: { default: "ChairScope", template: "%s | ChairScope" },
  description: "オフィスチェアの比較と最安情報を毎日自動更新。",
  openGraph: {
    type: "website",
    siteName: "ChairScope",
    images: [{ url: "/og-default.png" }],
  },
  twitter: { card: "summary_large_image" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">
        <SiteHeader />
        {/* 各ページのメイン */}
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
