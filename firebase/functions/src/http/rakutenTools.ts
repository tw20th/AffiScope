// firebase/functions/src/http/rakutenTools.ts
import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

import { searchItems } from "../services/rakuten/client.js";
import { mapRakutenToProduct } from "../lib/products/mapRakutenToProduct.js";
import { shouldKeepRakutenItem } from "../lib/products/rakutenFilters.js";

const REGION = "asia-northeast1";

const RAKUTEN_APP_ID = defineSecret("RAKUTEN_APP_ID");
const RAKUTEN_AFFILIATE_ID = defineSecret("RAKUTEN_AFFILIATE_ID");
const ADMIN_TASK_SECRET = defineSecret("ADMIN_TASK_SECRET");

function assertAdmin(req: functions.https.Request) {
  const header =
    req.headers["x-admin-secret"] ||
    req.headers["x-admin-key"] ||
    req.query.secret;
  if (header !== ADMIN_TASK_SECRET.value()) {
    throw new functions.https.HttpsError("permission-denied", "unauthorized");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 直列で pageStart..pageEnd を巡回し upsert（1req/secを守る遅延つき） */
export const runSeedRakuten = functions
  .region(REGION)
  .runWith({
    secrets: [RAKUTEN_APP_ID, RAKUTEN_AFFILIATE_ID, ADMIN_TASK_SECRET],
  })
  .https.onRequest(async (req, res) => {
    try {
      assertAdmin(req);

      const siteId = String(req.query.siteId || "").trim();
      const categoryId = String(req.query.categoryId || "").trim();
      const keyword = String(req.query.keyword || "").trim();

      const hits = Math.min(30, Math.max(1, Number(req.query.hits || 30)));
      const pageStart = Math.min(
        100,
        Math.max(1, Number(req.query.pageStart || 1))
      );
      const pageEnd = Math.min(
        100,
        Math.max(pageStart, Number(req.query.pageEnd || pageStart))
      );
      const delayMs = Math.max(1000, Number(req.query.delayMs || 1200)); // 1.2s 推奨

      if (!siteId || !categoryId || !keyword) {
        res
          .status(400)
          .json({ error: "siteId, categoryId, keyword are required" });
        return;
      }

      const db = getFirestore();
      const col = db.collection("products");
      let total = 0;

      for (let page = pageStart; page <= pageEnd; page++) {
        const { items } = await searchItems({
          keyword,
          hits,
          page,
          sort: "+itemPrice",
        });

        if (!items.length) break;

        // フィルタを適用
        const filtered: any[] = [];
        for (const it of items) {
          const keep = await shouldKeepRakutenItem({
            siteId,
            title: String(it?.itemName || ""),
          });
          if (keep) filtered.push(it);
        }
        if (!filtered.length) {
          if (page < pageEnd) await sleep(delayMs);
          continue;
        }

        const batch = db.batch();
        const now = Date.now();

        for (const it of filtered) {
          const mapped = mapRakutenToProduct(it, { siteId, categoryId, now });
          batch.set(col.doc(mapped.asin), mapped, { merge: true });
        }
        await batch.commit();
        total += filtered.length;

        if (page < pageEnd) await sleep(delayMs); // 1req/sec を守る
      }

      res.json({
        ok: true,
        count: total,
        siteId,
        categoryId,
        keyword,
        pageStart,
        pageEnd,
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: String(e?.message ?? "error") });
    }
  });

/** 軽量更新（価格/レビュー中心） */
export const runUpdateRakuten = functions
  .region(REGION)
  .runWith({
    secrets: [RAKUTEN_APP_ID, RAKUTEN_AFFILIATE_ID, ADMIN_TASK_SECRET],
  })
  .https.onRequest(async (req, res) => {
    try {
      assertAdmin(req);

      const siteId = String(req.query.siteId || "").trim();
      const categoryId = String(req.query.categoryId || "").trim();
      const keyword = String(req.query.keyword || "").trim();

      const hits = Math.min(30, Math.max(1, Number(req.query.hits || 30)));
      const pageStart = Math.min(
        100,
        Math.max(1, Number(req.query.pageStart || 1))
      );
      const pageEnd = Math.min(
        100,
        Math.max(pageStart, Number(req.query.pageEnd || pageStart))
      );
      const delayMs = Math.max(1000, Number(req.query.delayMs || 1200));

      if (!siteId || !categoryId || !keyword) {
        res
          .status(400)
          .json({ error: "siteId, categoryId, keyword are required" });
        return;
      }

      const db = getFirestore();
      const col = db.collection("products");
      const now = Date.now();
      let total = 0;

      for (let page = pageStart; page <= pageEnd; page++) {
        const { items } = await searchItems({
          keyword,
          hits,
          page,
          sort: "+itemPrice",
        });
        if (!items.length) break;

        // フィルタを適用
        const filtered: any[] = [];
        for (const it of items) {
          const keep = await shouldKeepRakutenItem({
            siteId,
            title: String(it?.itemName || ""),
          });
          if (keep) filtered.push(it);
        }
        if (!filtered.length) {
          if (page < pageEnd) await sleep(delayMs);
          continue;
        }

        const batch = db.batch();

        for (const it of filtered) {
          const mapped = mapRakutenToProduct(it, { siteId, categoryId, now });
          batch.set(
            col.doc(mapped.asin),
            {
              affiliateUrl: mapped.affiliateUrl,
              bestPrice: mapped.bestPrice,
              reviewAverage: mapped.reviewAverage,
              reviewCount: mapped.reviewCount,
              updatedAt: now,
              siteId,
              categoryId,
              source: "rakuten",
              title: mapped.title,
              imageUrl: mapped.imageUrl,
              brand: mapped.brand,
            },
            { merge: true }
          );
        }
        await batch.commit();
        total += filtered.length;

        if (page < pageEnd) await sleep(delayMs);
      }

      res.json({
        ok: true,
        count: total,
        siteId,
        categoryId,
        keyword,
        pageStart,
        pageEnd,
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: String(e?.message ?? "error") });
    }
  });
