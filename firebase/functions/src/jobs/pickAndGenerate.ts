import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

const REGION = "asia-northeast1";

export const pickAndGenerateDaily = functions
  .region(REGION)
  .pubsub.schedule("0 12 * * *") // JST 21時ごろにしたいなら "0 12 * * *" + timeZone設定
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const db = getFirestore();

    // 1) 候補選定（例: 昨日以降で priceHistory に変化があったもの）
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await db
      .collection("products")
      .where("updatedAt", ">=", since)
      .limit(3)
      .get();

    const tasks = snap.docs.map(async (doc) => {
      const p = doc.data() as any;
      const slug = `price-drop-${doc.id}`; // 簡易
      const exists = await db.collection("blogs").doc(slug).get();
      if (exists.exists) return;

      const md = [
        `# ${p.title} が値下げ！`,
        "",
        `最安値: **¥${p.bestPrice?.price?.toLocaleString?.() ?? "-"}**`,
        "",
        "## ポイント",
        "- ここに特徴を3点（自動抽出予定）",
        "",
        "## どこで買う？",
        `- [Amazonで見る](${p.bestPrice?.url ?? "#"})`,
        "",
        "## まとめ",
        "用途別のおすすめも今後自動挿入",
      ].join("\n");

      await db
        .collection("blogs")
        .doc(slug)
        .set({
          slug,
          siteId: p.siteId,
          title: `${p.title} 値下げ情報`,
          relatedAsin: p.asin,
          content: md,
          tags: ["値下げ", p.categoryId].filter(Boolean),
          status: "draft",
          views: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
    });

    await Promise.all(tasks);
  });
