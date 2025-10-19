// Usage:
//   pnpm -C firebase/functions exec tsx src/scripts/peekQueueByStatus.ts <siteId> <status> [--limit=20]
// status: queued | processing | done | failed
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function fmt(ts?: number) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

async function main() {
  const [siteId, statusRaw, ...rest] = process.argv.slice(2).filter(Boolean);
  if (!siteId || !statusRaw) {
    console.error(
      "Usage: tsx src/scripts/peekQueueByStatus.ts <siteId> <queued|processing|done|failed> [--limit=20]"
    );
    process.exit(1);
  }
  const limitArg =
    Number((rest.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) ||
    20;

  const snap = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .where("status", "==", statusRaw)
    .orderBy("updatedAt", "desc")
    .limit(limitArg)
    .get();

  const rows = snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      id: d.id,
      asin: x.asin,
      attempts: x.attempts || 0,
      priority: x.priority || 0,
      updatedAt: fmt(x.updatedAt),
      error: x.error || "",
    };
  });

  // 素朴にコンソール表示
  console.table(rows);
  if (rows.length === 0) console.log("(no documents)");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
