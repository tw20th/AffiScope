import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getSite, loadAllSites } from "../../lib/sites/siteFiles.js";
import { retagBySiteRules } from "../../lib/products/tagging.js";
import { resolvePain } from "../../lib/content/painResolver.js";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function matchByKeywords(
  title: string,
  inc?: string[],
  exc?: string[]
): boolean {
  const t = title.toLowerCase();
  if (exc?.some((k) => new RegExp(k, "i").test(t))) return false;
  if (inc?.length) return inc.some((k) => new RegExp(k, "i").test(t));
  return true;
}

function pickAffiliateUrl(p: any): string | undefined {
  const url = (typeof p.affiliateUrl === "string" && p.affiliateUrl) || "";
  return url || undefined;
}

export async function projectCatalogForSite(siteId: string, limit = 1000) {
  const site = getSite(siteId);
  if (!site) throw new Error(`site not found: ${siteId}`);

  const catCol = db.collection("catalog").doc("products").collection("items");

  // ★ 重要: 必ず siteId で絞る（categoryPreset では絞らない）
  const q: FirebaseFirestore.Query = catCol
    .where("siteId", "==", siteId)
    .orderBy("updatedAt", "desc")
    .limit(limit);

  // もし in フィルタで preset を使いたい場合は、category が null の商品を失わないため
  // 二段クエリにする必要があるが、ここではシンプルに siteId のみで取得し、
  // 下のアプリ側キーワードで足切りする。

  const snap = await q.get();

  const batch = db.batch();
  let scanned = 0,
    written = 0,
    skipped = 0;

  for (const d of snap.docs) {
    scanned++;
    const p = d.data() as any;
    const title = String(p.productName || p.title || "");

    // include/exclude キーワードで足切り
    const inc = site.productRules?.includeKeywords;
    const exc = site.productRules?.excludeKeywords;
    if (!matchByKeywords(title, inc, exc)) {
      skipped++;
      continue;
    }

    // サイト別タグ
    const siteTags = await retagBySiteRules(siteId, {
      title,
      specs: p.specs ?? {},
      bestPrice: typeof p.price === "number" ? { price: p.price } : undefined,
    });

    // サイト別の“悩み”
    const pain = resolvePain(site as any, { tags: siteTags });

    const proj = {
      productId: d.id, // catalog の dedupeKey
      productName: p.productName,
      imageUrl: p.imageUrl ?? null,
      price: p.price ?? null,
      affiliateUrl: pickAffiliateUrl(p),
      offers: Array.isArray(p.offers) ? p.offers : [],
      capacity: p.capacity ?? null,
      outputPower: p.outputPower ?? null,
      weight: p.weight ?? null,
      hasTypeC: !!p.hasTypeC,
      tags: siteTags,
      pains: [pain.pain],
      aiSummary: p.aiSummary ?? "",
      category: p.category ?? null,
      updatedAt: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    };

    const ref = db
      .collection("sites")
      .doc(siteId)
      .collection("monitoredItems")
      .doc(d.id);

    batch.set(ref, proj, { merge: true });
    written++;
  }

  if (written) await batch.commit();
  return { siteId, scanned, written, skipped };
}

export async function projectAllSites(limitPerSite = 1000) {
  const sites = loadAllSites().map((s) => s.siteId);
  const out: any[] = [];
  for (const id of sites) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await projectCatalogForSite(id, limitPerSite));
  }
  return out;
}
