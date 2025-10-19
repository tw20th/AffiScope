import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import { makeGscJwt, resolvePropertyUrl } from "../../services/gsc/client.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const GSC_SA_JSON = defineSecret("GSC_SA_JSON"); // Secret Manager

type Row = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

async function fetchQueries(
  saJson: string,
  propertyUrl: string,
  days = 28
): Promise<Row[]> {
  const sc = makeGscJwt(saJson);
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - (days - 1) * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data } = await sc.searchanalytics.query({
    siteUrl: propertyUrl,
    requestBody: {
      startDate: start,
      endDate: end,
      dimensions: ["QUERY"],
      rowLimit: 1000,
    },
  });

  const rows: Row[] = (data.rows || [])
    .map((r) => ({
      query: r.keys?.[0] || "",
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr:
        r.impressions ?? 0
          ? Number(r.clicks || 0) / Number(r.impressions || 1)
          : 0,
      position: r.position ?? 0,
    }))
    .filter((r) => r.query);

  return rows;
}

async function saveRows(siteId: string, rows: Row[]) {
  const now = Date.now();
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const col = db.collection("sites").doc(siteId).collection("seo");
  await col.doc("latest").set({ rows, updatedAt: now });
  await col.doc(ymd).set({ rows, updatedAt: now });
}

async function runOnceForSite(saJson: string, siteId: string) {
  const sdoc = await db.collection("sites").doc(siteId).get();
  if (!sdoc.exists) throw new Error(`site ${siteId} not found`);
  const site = sdoc.data() as {
    domain?: string;
    gsc?: { propertyUrl?: string };
  };

  const propertyUrl = resolvePropertyUrl(site);
  const rows = await fetchQueries(saJson, propertyUrl, 28);
  await saveRows(siteId, rows);
  return { siteId, count: rows.length, propertyUrl };
}

export const scheduledPullGsc = functions
  .runWith({ secrets: [GSC_SA_JSON], timeoutSeconds: 300, memory: "256MB" })
  .region("asia-northeast1")
  .pubsub.schedule("30 2 * * *") // JST 02:30 毎日
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const saJson = GSC_SA_JSON.value();
    const snap = await db.collection("sites").get();
    const siteIds = snap.docs.map((d) => d.id);
    const results = [];
    for (const siteId of siteIds) {
      try {
        results.push(await runOnceForSite(saJson, siteId));
      } catch (e) {
        console.error("[scheduledPullGsc] fail", siteId, e);
      }
    }
    return { results };
  });

export const runPullGscNow = functions
  .runWith({ secrets: [GSC_SA_JSON] })
  .region("asia-northeast1")
  .https.onRequest(async (req, res) => {
    try {
      const siteId = String(req.query.siteId || "").trim();
      if (!siteId)
        return void res
          .status(400)
          .json({ ok: false, error: "siteId required" });
      const saJson = GSC_SA_JSON.value();
      const result = await runOnceForSite(saJson, siteId);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
