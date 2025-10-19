// firebase/functions/src/scripts/reportQuality.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { parseArgs } from "node:util";

if (!getApps().length) initializeApp();
const db = getFirestore();

type Product = {
  siteId: string;
  categoryId?: string;
  title?: string;
  imageUrl?: string;
  brand?: string;
  bestPrice?: { price?: number };
  offers?: Array<{ price?: number; source?: string; url?: string }>;
  aiSummary?: string;
  tags?: string[];
  updatedAt?: number;
};

function parseSince(input?: string): number {
  if (!input) return Date.now() - 24 * 60 * 60 * 1000;
  if (/^\d+d$/.test(input))
    return Date.now() - Number(input.replace("d", "")) * 86400000;
  if (/^\d+h$/.test(input))
    return Date.now() - Number(input.replace("h", "")) * 3600000;
  const t = Date.parse(input!);
  if (!Number.isFinite(t)) throw new Error(`Invalid --since: ${input}`);
  return t;
}

function looksInvalidForCategory(p: Product): boolean {
  const title = (p.title || "").toLowerCase();
  const cat = (p.categoryId || "").toLowerCase();
  if (cat === "gaming-chair") {
    // “チェア/椅子/chair” を含まず “クッション/カバー/キャスター” だけ出てくるのは怪しい
    const isChairish = /(チェア|椅子|chair)/i.test(p.title || "");
    const isAccessory = /(クッション|替えカバー|キャスター|座布団|マット)/.test(
      p.title || ""
    );
    if (!isChairish && isAccessory) return true;
  }
  return false;
}

(async () => {
  const { values } = parseArgs({
    options: {
      site: { type: "string" },
      since: { type: "string" },
      limit: { type: "string" },
    },
  });
  const sinceMs = parseSince(values.since as string | undefined);
  const siteId = (values.site as string | undefined) || "";
  const exampleLimit = Number(values.limit || 10);

  const base = db.collection("products").where("updatedAt", ">=", sinceMs);
  const q = siteId ? base.where("siteId", "==", siteId) : base;
  const snap = await q.get();

  let total = 0;
  let missImage = 0,
    missBrand = 0,
    missPrice = 0,
    missOffers = 0,
    missSummary = 0,
    thinTags = 0,
    catMismatch = 0;

  const examples: Array<{
    id: string;
    title?: string;
    reason: string;
    siteId: string;
  }> = [];

  snap.forEach((d) => {
    const p = d.data() as Product;
    total++;

    if (!p.imageUrl) {
      missImage++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "no imageUrl",
        });
    }
    if (!p.brand) {
      missBrand++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "no brand",
        });
    }
    const price = p.bestPrice?.price ?? 0;
    if (!price || price <= 0) {
      missPrice++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "no/bad price",
        });
    }
    if (!p.offers || p.offers.length === 0) {
      missOffers++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "no offers",
        });
    }
    if (!p.aiSummary || p.aiSummary.trim().length < 10) {
      missSummary++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "no/short aiSummary",
        });
    }
    if (!p.tags || p.tags.length === 0) {
      thinTags++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "no tags",
        });
    }
    if (looksInvalidForCategory(p)) {
      catMismatch++;
      if (examples.length < exampleLimit)
        examples.push({
          id: d.id,
          title: p.title,
          siteId: p.siteId,
          reason: "maybe not a chair",
        });
    }
  });

  const sinceIso = new Date(sinceMs).toISOString();
  console.log(
    `\n=== Quality Report ${siteId ? `(${siteId}) ` : ""}since ${sinceIso} ===`
  );
  console.log(`checked: ${total}`);
  console.log(
    [
      `no image: ${missImage}`,
      `no brand: ${missBrand}`,
      `no/bad price: ${missPrice}`,
      `no offers: ${missOffers}`,
      `no/short aiSummary: ${missSummary}`,
      `no tags: ${thinTags}`,
      `maybe category mismatch: ${catMismatch}`,
    ].join(" | ")
  );

  if (examples.length) {
    console.log("\n--- examples ---");
    for (const ex of examples) {
      console.log(
        `[${ex.siteId}] ${ex.id}  reason=${ex.reason}  title="${
          ex.title ?? ""
        }"`
      );
    }
  }
})();
