import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

type Blog = {
  slug: string;
  status: "draft" | "published";
  siteId: string;
  updatedAt: number;
  title?: string;
};

const REGION = "asia-northeast1";

/**
 * blogs/{slug} の status が draft -> published になったら:
 *  - Next.js ISR 再検証
 *  - sitemap ping
 *  - IndexNow 送信（Bing など）
 */
export const onPublishBlog = functions
  .region(REGION)
  .firestore.document("blogs/{slug}")
  .onWrite(async (change, ctx) => {
    const after = change.after.exists ? (change.after.data() as Blog) : null;
    const before = change.before.exists ? (change.before.data() as Blog) : null;

    if (!after) return;

    const becamePublished =
      after.status === "published" &&
      (!before || before.status !== "published");

    if (!becamePublished) return;

    const slug = ctx.params.slug as string;
    const siteId = after.siteId;
    const updatedAt = after.updatedAt || Date.now();

    // 1) Next.js ISR 再検証（/blog/[slug] と トップ/カテゴリも）
    await revalidatePaths([
      `/blog/${slug}`,
      `/`, // 必要に応じて
      `/category/${encodeURIComponent(siteId)}`, // 例: サイト別ハブなど
    ]);

    // 2) sitemap ping
    await pingSitemaps(updatedAt);

    // 3) IndexNow
    await sendIndexNow([`https://${process.env.PUBLIC_HOST}/blog/${slug}`]);

    // 4) ついでに "lastPublishedAt" を保存（任意）
    await getFirestore()
      .collection("blogs")
      .doc(slug)
      .set({ lastPublishedAt: Date.now() }, { merge: true });
  });

async function revalidatePaths(paths: string[]) {
  const host = process.env.PUBLIC_HOST; // 例: chairscope.com
  const token = process.env.REVALIDATE_TOKEN; // 任意の長い文字列
  if (!host || !token) return;

  // Next.js 側のAPI（後述）に叩く
  const url = `https://${host}/api/revalidate?secret=${encodeURIComponent(
    token
  )}`;
  await Promise.allSettled(
    paths.map((p) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p }),
      })
    )
  );
}

async function pingSitemaps(lastmod: number) {
  const host = process.env.PUBLIC_HOST;
  if (!host) return;

  // Googleのsitemap ping（任意）
  const sitemapUrl = `https://${host}/sitemap.xml`;
  const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(
    sitemapUrl
  )}`;
  await fetch(pingUrl).catch(() => void 0);

  // Bing/IndexNowは下の sendIndexNow を推奨
}

async function sendIndexNow(urls: string[]) {
  const key = process.env.INDEXNOW_KEY;
  const keyLocation = process.env.INDEXNOW_KEY_URL; // 例: https://chairscope.com/indexnow.txt
  const host = process.env.PUBLIC_HOST;
  if (!key || !keyLocation || !host) return;

  const body = {
    host,
    urlList: urls,
    key,
    keyLocation,
  };

  // Bing の IndexNow
  await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  }).catch(() => void 0);
}
