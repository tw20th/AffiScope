// --- 追加/修正: 強ログ & フォールバック & 件数表示 ---
import { getFirestore } from "firebase-admin/firestore";
import { getSiteConfig } from "../lib/sites.js";
import { resolvePain } from "../lib/painResolver.js";
import { generateBlogContent } from "../utils/generateBlogContent.js";
import * as functions from "firebase-functions";

const REGION = "asia-northeast1";
const db = getFirestore();

/** 手動/スケジュール両対応の実行本体 */
export async function runPickAndGenerateOnce(opts?: {
  siteId?: string;
  limit?: number;
}) {
  const limit = opts?.limit ?? 3;

  // 候補を 24h → 7d → 全体desc の順でフォールバック
  const now = Date.now();
  const windows = [24, 24 * 7];
  let snap: FirebaseFirestore.QuerySnapshot | null = null;

  const base = db.collection("products");
  const withSite = (q: FirebaseFirestore.Query) =>
    opts?.siteId ? q.where("siteId", "==", opts.siteId) : q;

  for (const h of windows) {
    const q = withSite(
      base.where("updatedAt", ">=", now - h * 60 * 60 * 1000)
    ).limit(limit);
    const s = await q.get();
    if (!s.empty) {
      snap = s;
      break;
    }
  }
  if (!snap) {
    const q = withSite(base.orderBy("updatedAt", "desc")).limit(limit);
    snap = await q.get();
  }

  console.log(
    `[pickAndGenerate] candidates=${snap.size} siteId=${
      opts?.siteId ?? "-"
    } limit=${limit}`
  );

  if (snap.empty) {
    console.warn("[pickAndGenerate] no product candidates found.");
    return { generated: 0, failed: 0 };
  }

  let success = 0,
    fail = 0;
  for (const d of snap.docs) {
    const p = d.data() as any;
    const asin = p.asin;
    const siteId = p.siteId;
    const slug = `price-drop-${siteId}_${asin}`;

    try {
      const site = getSiteConfig(siteId);
      const { pain, persona } = resolvePain(site, { tags: p.tags });

      console.log(
        `[pickAndGenerate] start asin=${asin} siteId=${siteId} pain="${pain}" persona="${persona}"`
      );

      const { title, excerpt, content, tags, imageUrl } =
        await generateBlogContent({
          product: {
            name: p.productName ?? p.name ?? "(no name)",
            asin,
            tags: p.tags,
          },
          siteId,
          siteName: site?.displayName ?? siteId,
          persona,
          pain,
        });

      await db.collection("blogs").doc(slug).set(
        {
          slug,
          siteId: p.siteId, // ← これ。ハードコード禁止
          status: "draft", // すぐ出したいなら "published"
          title,
          summary: excerpt,
          content,
          tags,
          imageUrl,
          relatedAsin: p.asin,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          views: 0,
        },
        { merge: true }
      );

      console.log(`[pickAndGenerate] wrote blogs/${slug} (status=draft)`);
      success++;
    } catch (e: any) {
      console.error(
        `[pickAndGenerate] ✖ failed asin=${asin} slug=${slug}:`,
        e?.message ?? e
      );
      fail++;
    }
  }

  console.log(`[pickAndGenerate] done success=${success} fail=${fail}`);
  return { generated: success, failed: fail };
}

// 既存のスケジュール関数は共通本体を呼ぶだけ
export const pickAndGenerateDaily = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 12 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(() => runPickAndGenerateOnce());
