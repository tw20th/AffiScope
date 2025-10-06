// firebase/functions/src/jobs/publishBlog.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

type Blog = {
  slug: string;
  status: "draft" | "published";
  siteId: string;
  updatedAt?: number;
  publishedAt?: number;
  title?: string;
};

const REGION = "asia-northeast1";

/** サイト設定を sites/{siteId}.json から読む（キャッシュ付） */
type SiteConfig = { siteId: string; displayName?: string; domain: string };
const siteCache = new Map<string, SiteConfig>();
function getSiteConfig(siteId: string): SiteConfig | null {
  if (siteCache.has(siteId)) return siteCache.get(siteId)!;
  const p = path.resolve(process.cwd(), `sites/${siteId}.json`);
  if (!fs.existsSync(p)) return null;
  const conf = JSON.parse(fs.readFileSync(p, "utf-8")) as SiteConfig;
  siteCache.set(siteId, conf);
  return conf;
}

/**
 * blogs/{slug} の status が draft -> published になったら:
 *  - publishedAt を初回公開時に保存
 *  - Next.js ISR 再検証（ホスト = サイトごとの domain）
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
    const site = getSiteConfig(siteId);
    if (!site?.domain) {
      console.warn(
        `[onPublishBlog] site config not found or no domain: ${siteId}`
      );
      return;
    }

    const now = Date.now();
    const publishedAt = after.publishedAt ?? now;

    // 1) publishedAt / lastPublishedAt を保存
    await getFirestore()
      .collection("blogs")
      .doc(slug)
      .set(
        { publishedAt, lastPublishedAt: now, updatedAt: now },
        { merge: true }
      );

    // 2) ISR 再検証（ブログ詳細 / トップ / ブログ一覧）
    await revalidatePaths(site.domain, [`/blog/${slug}`, `/`, `/blog`]);

    // 3) sitemap ping
    await pingSitemaps(site.domain);

    // 4) IndexNow 送信
    await sendIndexNow(site.domain, [`https://${site.domain}/blog/${slug}`]);
  });

async function revalidatePaths(host: string, paths: string[]) {
  const token = process.env.REVALIDATE_TOKEN; // 任意の長い文字列
  if (!host || !token) return;
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

async function pingSitemaps(host: string) {
  if (!host) return;
  const sitemapUrl = `https://${host}/sitemap.xml`;
  const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(
    sitemapUrl
  )}`;
  await fetch(pingUrl).catch(() => void 0);
}

async function sendIndexNow(host: string, urls: string[]) {
  const key = process.env.INDEXNOW_KEY;
  const keyLocation = process.env.INDEXNOW_KEY_URL; // 例: https://<host>/indexnow.txt
  if (!host || !key || !keyLocation) return;
  const body = { host, urlList: urls, key, keyLocation };
  await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  }).catch(() => void 0);
}
