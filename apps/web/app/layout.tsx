import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
