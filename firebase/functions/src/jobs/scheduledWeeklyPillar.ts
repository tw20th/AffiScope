// firebase/functions/src/jobs/scheduledWeeklyPillar.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";

const REGION = "asia-northeast1";
const db = getFirestore();

/** 遅延初期化の OpenAI クライアント */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY is not set (runtime).");
  return (_openai ??= new OpenAI({ apiKey: k }));
}

type SiteDoc = {
  siteId: string;
  keywordPools?: { comparison?: string[]; guide?: string[] };
  contentPlan?: { weekly?: { pillarIntent?: string } };
};

async function pickSiteIds(): Promise<string[]> {
  const snap = await db
    .collection("sites")
    .where("features.blogs", "==", true)
    .get();
  return snap.docs
    .map((d) => (d.data() as { siteId?: string }).siteId!)
    .filter(Boolean);
}

function slugFromKeyword(siteId: string, kw: string) {
  const s = kw
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `pillar-${siteId}-${s}-${ymd}`;
}

async function pickKeyword(site: SiteDoc): Promise<string | null> {
  const pool = site.keywordPools?.comparison ?? [];
  if (!pool.length) return null;

  // まだ使っていないキーワード優先（slug 存在チェック）
  for (const kw of pool) {
    const slug = slugFromKeyword(site.siteId, kw);
    const exists = await db.collection("blogs").doc(slug).get();
    if (!exists.exists) return kw;
  }
  return null;
}

export const scheduledWeeklyPillar = functions
  .region(REGION)
  .runWith({ secrets: ["OPENAI_API_KEY"] })
  .pubsub.schedule("0 9 * * 0") // 日曜 09:00 JST
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const siteIds = await pickSiteIds();
    const openai = getOpenAI();
    const results: Array<{ siteId: string; slug?: string | null }> = [];

    for (const siteId of siteIds) {
      const sdoc = await db.collection("sites").doc(siteId).get();

      // ❗️重複 siteId を避ける（上書きの警告対策）
      const raw = (sdoc.data() as SiteDoc) ?? ({} as SiteDoc);
      const { siteId: _ignore, ...rest } = raw;
      const site: SiteDoc = {
        siteId,
        ...(rest as Partial<SiteDoc>),
      } as SiteDoc;

      const kw = await pickKeyword(site);
      if (!kw) {
        results.push({ siteId, slug: null });
        continue;
      }

      const slug = slugFromKeyword(siteId, kw);

      const sys =
        "あなたは日本語のSEOライターです。比較・選び方の“柱記事”をMarkdownで作成してください。";
      const user =
        `サイト: ${siteId}\nキーワード: ${kw}\n` +
        `出力要件:\n` +
        `- # タイトル（誇張せずクリックされやすい）\n` +
        `- 導入：読者の悩み→結論（どんな人は何を選ぶべきか）\n` +
        `- ## 比較表（最低5行、列: 価格/材質/リクライニング/オットマン/重量）\n` +
        `- ## 選び方の軸（3〜5項目）\n` +
        `- ## おすすめ3選（内部リンクや製品ページへの導線）\n` +
        `- ## FAQ（3問）\n` +
        `- 末尾にCTA（Amazonリンク表記）\n` +
        `- 可能ならFAQのJSON-LDも <script type="application/ld+json"> で添付`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      });

      const content =
        resp.choices[0]?.message?.content?.trim() ??
        `# ${kw}｜比較・選び方ガイド`;
      const now = Date.now();

      await db
        .collection("blogs")
        .doc(slug)
        .set(
          {
            slug,
            siteId,
            status: "published",
            title: `${kw}｜比較・選び方ガイド`,
            summary: null,
            content,
            imageUrl: null,
            tags: ["比較", "選び方", "柱"],
            relatedAsin: null,
            createdAt: now,
            updatedAt: now,
            publishedAt: now,
            views: 0,
            targetKeyword: kw,
          },
          { merge: false }
        );

      results.push({ siteId, slug });
    }

    return { results };
  });
