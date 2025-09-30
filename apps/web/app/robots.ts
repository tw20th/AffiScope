import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.chairscope.com"
  ).replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 管理画面やAPIを公開してないなら特に明示不要。必要なら disallow を追加
    },
    sitemap: [`${base}/sitemap.xml`],
  };
}
