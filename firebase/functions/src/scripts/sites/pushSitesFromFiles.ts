import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type SiteFile = {
  siteId: string;
  displayName?: string;
  domain?: string;
  features?: { blogs?: boolean; ranking?: boolean };
  tagRules?: any[];
  painRules?: any[];
  productRules?: any;
  discovery?: any;
  rakutenKeywords?: string[];
  rakutenCategoryMap?: Record<string, string>;
  defaultCategoryId?: string;
};

async function main() {
  const SITES_DIR = path.resolve(process.cwd(), "sites");
  const files = fs.readdirSync(SITES_DIR).filter((f) => f.endsWith(".json"));
  let writes = 0;

  for (const f of files) {
    const json = JSON.parse(
      fs.readFileSync(path.join(SITES_DIR, f), "utf-8")
    ) as SiteFile;

    if (!json.siteId) continue;
    const docId = json.siteId;

    // Firestore に必要なフィールドだけ投影（他はそのままでもOK）
    const payload = {
      siteId: json.siteId,
      displayName: json.displayName ?? null,
      domain: json.domain ?? null,
      features: json.features ?? {},
      tagRules: json.tagRules ?? [],
      painRules: json.painRules ?? [],
      productRules: json.productRules ?? {},
      discovery: json.discovery ?? {},
      rakutenKeywords: Array.isArray(json.rakutenKeywords)
        ? json.rakutenKeywords
        : [],
      rakutenCategoryMap: json.rakutenCategoryMap ?? {},
      defaultCategoryId: json.defaultCategoryId ?? null,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };

    await db.collection("sites").doc(docId).set(payload, { merge: true });
    console.log(`upsert sites/${docId}`);
    writes++;
  }

  console.log(`done. updated ${writes} site docs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
