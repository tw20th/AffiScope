// firebase/functions/src/scripts/syncSites.ts
/**
 * sites/<siteId>.json を Firestore の sites/<siteId> に同期する
 *
 * 使い方:
 *   # 単一サイト
 *   pnpm -C firebase/functions exec tsx src/scripts/syncSites.ts chairscope
 *
 *   # 全サイト
 *   pnpm -C firebase/functions exec tsx src/scripts/syncSites.ts --all
 */

try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type SiteConfig = Record<string, unknown> & { siteId?: string };

function loadJson(filePath: string) {
  const txt = readFileSync(filePath, "utf8");
  return JSON.parse(txt);
}

function sitesDir() {
  // <repo>/firebase/functions/sites
  return resolve(process.cwd(), "src", "..", "sites");
}

async function syncOne(siteId: string) {
  const file = join(sitesDir(), `${siteId}.json`);
  const data = loadJson(file) as SiteConfig;

  if (!data) throw new Error(`site json not found or invalid: ${file}`);
  if (data.siteId && data.siteId !== siteId) {
    throw new Error(`mismatch siteId: expected=${siteId}, json=${data.siteId}`);
  }

  const ref = db.collection("sites").doc(siteId);
  const now = Date.now();
  const snap = await ref.get();

  const payload: Record<string, unknown> = {
    ...data,
    siteId, // 最終保証
    updatedAt: now,
    ...(snap.exists ? {} : { createdAt: now }),
  };

  await ref.set(payload, { merge: true });

  const kp = (data as any)?.keywordPools;
  console.log(
    `[sync] upsert sites/${siteId}` +
      ` | tagRules=${
        Array.isArray((data as any)?.tagRules)
          ? (data as any).tagRules.length
          : 0
      }` +
      ` | comparisonKW=${
        Array.isArray(kp?.comparison) ? kp.comparison.length : 0
      }`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const ids = args.filter((a) => a !== "--all");

  if (!all && ids.length === 0) {
    console.error(
      "Usage: tsx src/scripts/syncSites.ts <siteId>\n   or: tsx src/scripts/syncSites.ts --all"
    );
    process.exit(1);
  }

  if (all) {
    const files = readdirSync(sitesDir()).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const siteId = f.replace(/\.json$/i, "");
      await syncOne(siteId);
    }
  } else {
    for (const siteId of ids) await syncOne(siteId);
  }
}

main().catch((e) => {
  console.error("[syncSites] error:", e);
  process.exit(1);
});
