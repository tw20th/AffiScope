/**
 * sites/<siteId>.json を Firestore の sites/<siteId> に同期する
 *
 * 使い方:
 *   # 単一サイト
 *   pnpm -C firebase/functions exec tsx src/scripts/syncSites.ts chairscope
 *
 *   # ディレクトリ内の全サイトを同期（拡張子 .json のみ）
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

function loadJson(p: string) {
  const txt = readFileSync(p, "utf8");
  return JSON.parse(txt);
}

async function syncOne(siteId: string) {
  const base = resolve(process.cwd(), "src", "..", "sites"); // firebase/functions/sites
  const file = join(base, `${siteId}.json`);
  const data = loadJson(file) as SiteConfig;

  if (!data || (data.siteId && data.siteId !== siteId)) {
    throw new Error(
      `site json invalid: expected siteId=${siteId}, got ${data?.siteId}`
    );
  }
  // Firestoreドキュメントへ保存
  const ref = db.collection("sites").doc(siteId);
  const now = Date.now();
  const snapshot = await ref.get();

  const payload: Record<string, unknown> = {
    ...data,
    siteId, // 保険
    updatedAt: now,
    ...(snapshot.exists ? {} : { createdAt: now }),
  };

  await ref.set(payload, { merge: true });
  console.log(
    `[sync] upsert sites/${siteId} (tagRules=${
      Array.isArray((data as any).tagRules) ? (data as any).tagRules.length : 0
    })`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const ids = args.filter((a) => a !== "--all");

  if (!all && ids.length === 0) {
    console.error(
      "Usage: tsx src/scripts/syncSites.ts <siteId>  |  tsx src/scripts/syncSites.ts --all"
    );
    process.exit(1);
  }

  if (all) {
    const dir = resolve(process.cwd(), "src", "..", "sites"); // firebase/functions/sites
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const siteId = f.replace(/\.json$/i, "");
      await syncOne(siteId);
    }
  } else {
    for (const siteId of ids) {
      await syncOne(siteId);
    }
  }
}

main().catch((e) => {
  console.error("[syncSites] error:", e);
  process.exit(1);
});
