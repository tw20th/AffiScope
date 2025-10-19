// Usage:
//   pnpm -C firebase/functions exec tsx src/scripts/requeueByReason.ts <siteId> "<substr>" [--max=100]
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE)
    await import("dotenv/config");
} catch {}
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (getApps().length === 0) initializeApp();
const db = getFirestore();

async function main() {
  const [siteId, substr, ...rest] = process.argv.slice(2);
  if (!siteId || !substr) {
    console.error(
      'Usage: tsx src/scripts/requeueByReason.ts <siteId> "<substr>" [--max=100]'
    );
    process.exit(1);
  }
  const max =
    Number((rest.find((a) => a.startsWith("--max=")) || "").split("=")[1]) ||
    100;

  const snap = await db
    .collection("asinQueue")
    .where("siteId", "==", siteId)
    .where("status", "==", "failed")
    .limit(1000)
    .get();

  const targets = snap.docs
    .filter((d) => String((d.data() as any).error || "").includes(substr))
    .slice(0, max);
  const batch = db.batch();
  for (const d of targets) {
    batch.update(d.ref, { status: "queued", updatedAt: Date.now() });
  }
  await batch.commit();
  console.log({ siteId, requeued: targets.length, reasonIncludes: substr });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
