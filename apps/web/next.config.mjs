// apps/web/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // 外部画像ホストを列挙（Amazon / 楽天 / Unsplash）
    remotePatterns: [
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "thumbnail.image.rakuten.co.jp" },
      { protocol: "https", hostname: "image.rakuten.co.jp" },
      { protocol: "https", hostname: "shop.r10s.jp" },
      // ▼ 追加：Unsplash
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  reactStrictMode: true,
};

export default nextConfig;
