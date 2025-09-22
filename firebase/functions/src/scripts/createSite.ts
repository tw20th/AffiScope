import * as fs from "node:fs";
import * as path from "node:path";
import * as admin from "firebase-admin";

function db() {
  if (admin.apps.length === 0) admin.initializeApp();
  return admin.firestore();
}

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("Usage: ts-node src/scripts/createSite.ts <siteId>");
    process.exit(1);
  }

  const jsonPath = path.resolve(process.cwd(), `sites/${siteId}.json`);
  if (!fs.existsSync(jsonPath)) {
    console.error(`not found: ${jsonPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(raw);
  const now = Date.now();

  // createdAt/updatedAt を補完
  const doc = {
    ...data,
    siteId,
    createdAt: data.createdAt ?? now,
    updatedAt: now,
  };

  await db().collection("sites").doc(siteId).set(doc, { merge: true });
  console.log(`✔ created/updated sites/${siteId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
