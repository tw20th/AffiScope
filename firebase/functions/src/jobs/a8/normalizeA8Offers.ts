import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

function decideSites(title: string): string[] {
  const t = title.toLowerCase();
  const sites: string[] = [];
  if (
    t.includes("冷蔵") ||
    t.includes("洗濯") ||
    t.includes("レンタル") ||
    t.includes("サブスク")
  ) {
    sites.push("homeease");
  }
  // ここに chairscope / powerbank-scope 等の割当ルールを追加可能
  return sites.length ? sites : ["homeease"];
}

export const normalizeA8Offers = onRequest(async (_req, res) => {
  const db = getFirestore();
  const snap = await db.collection("offers").get();

  let updated = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    const o = doc.data() as { title?: string; dedupeKey?: string };
    const siteIds = decideSites(o.title ?? "");
    const tags: string[] = [];

    if (o.title?.includes("初回")) tags.push("first-offer");

    batch.set(
      doc.ref,
      {
        siteIds,
        tags,
      },
      { merge: true }
    );
    updated++;

    // バッチサイズが大きくなりすぎないよう適宜コミット
    if (updated % 400 === 0) {
      await batch.commit();
    }
  }

  await batch.commit();
  res.status(200).send({ ok: true, normalized: updated });
});
