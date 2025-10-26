import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { db } from "../../lib/admin.js";
import { enrichForSite } from "../../services/enrich/extractSpecs.js";
import type { Enriched } from "../../services/enrich/extractSpecs.js";

const REGION = "asia-northeast1";
const ADMIN_TASK_SECRET = defineSecret("ADMIN_TASK_SECRET");

function buildPatch(enriched: Enriched, p: any): Record<string, any> {
  const patch: Record<string, any> = {};

  // categoryId: 無い or 変わるなら更新
  if (enriched.categoryId && enriched.categoryId !== p.categoryId) {
    patch.categoryId = enriched.categoryId;
  }

  // tags: 無い or 空配列なら更新（明示的に上書きしたいときだけ set）
  if (!Array.isArray(p.tags) || p.tags.length === 0) {
    if (Array.isArray(enriched.tags) && enriched.tags.length > 0) {
      patch.tags = enriched.tags;
    }
  }

  // specs: まだ無いなら採用（上書きしたくなければ存在チェックのみ）
  if (!p.specs || Object.keys(p.specs || {}).length === 0) {
    if (enriched.specs && Object.keys(enriched.specs).length > 0) {
      patch.specs = enriched.specs;
    }
  }

  return patch;
}

async function runEnrich(params: {
  limit: number;
  siteId?: string;
}): Promise<number> {
  const { limit, siteId } = params;

  // 「存在しない」を where で表現できないため、updatedAt 降順で走査してコード側で判定
  let q = db.collection("products") as FirebaseFirestore.Query;
  if (siteId) q = q.where("siteId", "==", siteId);
  q = q.orderBy("updatedAt", "desc").limit(limit);

  const snap = await q.get();
  if (snap.empty) return 0;

  let updated = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    const p = doc.data() as any;
    const enriched = enrichForSite({
      siteId: p.siteId || "",
      title: p.title || "",
      categoryIdFallback: p.categoryId || "",
    });

    const patch = buildPatch(enriched, p);
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      batch.set(doc.ref, patch, { merge: true });
      updated++;
    }
  }

  if (updated > 0) await batch.commit();
  return updated;
}

/** 即時実行（HTTP） */
export const runEnrichRakutenNow = functions
  .region(REGION)
  .runWith({ secrets: [ADMIN_TASK_SECRET] })
  .https.onRequest(async (req, res) => {
    try {
      const provided =
        (req.get("x-admin-secret") as string) ||
        (req.get("x-admin-key") as string) ||
        (req.query.secret as string) ||
        "";
      const expected = ADMIN_TASK_SECRET.value();
      if (!expected || provided !== expected) {
        res.status(401).json({ ok: false, error: "unauthorized" });
        return;
      }

      const limit = Math.min(Number(req.query.limit ?? 500) || 500, 1000);
      const siteId = req.query.siteId ? String(req.query.siteId) : undefined;

      const updated = await runEnrich({ limit, siteId });
      res.json({ ok: true, updated, siteId: siteId ?? null, scanned: limit });
    } catch (e: any) {
      console.error("[runEnrichRakutenNow] error", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

/** スケジュール（毎日） */
export const scheduledEnrichRakuten = functions
  .region(REGION)
  .pubsub.schedule("every 24 hours")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const updated = await runEnrich({ limit: 1000 });
    console.log(`[scheduledEnrichRakuten] updated=${updated}`);
  });
