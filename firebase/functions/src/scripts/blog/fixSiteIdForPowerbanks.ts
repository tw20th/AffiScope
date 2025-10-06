/* eslint-disable no-console */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const KEYWORDS = [
  "モバイルバッテリー",
  "mAh",
  "Power Bank",
  "急速充電",
  "PD",
  "USB-C",
  "Type-C",
  "10000mAh",
  "20000mAh",
  "ワイヤレス充電",
  "PSE",
];

async function main() {
  const {
    PROJECT_ID,
    COLLECTION = "blogs",
    FROM_SITE_ID = "chairscope",
    TO_SITE_ID = "powerbank-scope",
    DRY_RUN = "false",
  } = process.env;

  if (!PROJECT_ID) {
    console.error("Set PROJECT_ID");
    process.exit(1);
  }

  initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  const snap = await db
    .collection(COLLECTION)
    .where("siteId", "==", FROM_SITE_ID)
    .get();
  console.log(`scan ${snap.size} docs with siteId=${FROM_SITE_ID}`);

  let patched = 0;
  for (const doc of snap.docs) {
    const b = doc.data() as { title?: string; content?: string; slug?: string };
    const hay = `${b.title ?? ""}\n${b.content ?? ""}`.toLowerCase();

    const hit = KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
    if (!hit) continue;

    if (DRY_RUN === "true") {
      console.log(`[dry-run] ${doc.id} -> siteId=${TO_SITE_ID}`);
      patched++;
      continue;
    }

    await doc.ref.set({ siteId: TO_SITE_ID }, { merge: true });
    console.log(`[ok] ${doc.id} -> siteId=${TO_SITE_ID}`);
    patched++;
  }

  console.log(`done. patched=${patched}/${snap.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
