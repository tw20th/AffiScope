import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { createHash } from "crypto";

// 依存が無ければ、まずは超簡易CSVパーサ（カンマ区切り/ヘッダあり想定）
function parseCsvSimple(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((s) => s.trim());
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function inferPlanType(text: string): "product" | "subscription" | "trial" {
  const t = text.toLowerCase();
  if (t.includes("無料") || t.includes("お試し") || t.includes("trial"))
    return "trial";
  if (
    t.includes("定期") ||
    t.includes("サブスク") ||
    t.includes("subscription")
  )
    return "subscription";
  return "product";
}

export const importA8Csv = onRequest(async (req, res) => {
  try {
    const csv = (req.body?.csv as string) ?? "";
    if (!csv) {
      res.status(400).send({ ok: false, reason: "csv required in body" });
      return;
    }

    // 列名はA8の出力に合わせて調整してください
    // 例: ProgramID, AdvertiserName, Category, MaterialID, Title, Description, Price, LandingURL, AffiliateURL, ImageURL
    const rows = parseCsvSimple(csv);
    const db = getFirestore();
    const now = Date.now();
    const batch = db.batch();

    let imported = 0;

    for (const r of rows) {
      const programId = r["ProgramID"] || r["program_id"];
      if (!programId) continue;

      const advertiser = r["AdvertiserName"] || r["advertiser"] || "";
      const category = (r["Category"] || "")
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean);
      const programRef = db.collection("programs").doc(programId);
      batch.set(
        programRef,
        {
          programId,
          advertiser,
          category,
          approval: "approved",
          siteIds: [], // normalize側で付与
          updatedAt: now,
        },
        { merge: true }
      );

      const materialId = r["MaterialID"] || r["material_id"] || "";
      const landingUrl = r["LandingURL"] || r["landing_url"] || "";
      const offerId = materialId
        ? `${programId}:${materialId}`
        : `${programId}:${sha1(landingUrl)}`;
      const title = r["Title"] || r["MaterialName"] || "";
      const desc = r["Description"] || "";
      const priceNum = Number(r["Price"] || "");
      const price = Number.isFinite(priceNum) ? priceNum : undefined;
      const img = r["ImageURL"] || "";

      const dedupeKey = `${programId}:${landingUrl || title}`;
      const offerRef = db.collection("offers").doc(offerId);
      batch.set(
        offerRef,
        {
          id: offerId,
          programId,
          title,
          description: desc || undefined,
          price,
          planType: inferPlanType(`${title} ${desc}`),
          landingUrl,
          affiliateUrl: r["AffiliateURL"] || r["affiliate_url"] || landingUrl,
          images: img ? [img] : [],
          badges: [],
          tags: [],
          dedupeKey,
          siteIds: [], // normalize側で付与
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      imported++;
    }

    await batch.commit();
    res.status(200).send({ ok: true, imported });
  } catch (e) {
    logger.error(e);
    res.status(500).send({ ok: false, error: (e as Error).message });
  }
});
