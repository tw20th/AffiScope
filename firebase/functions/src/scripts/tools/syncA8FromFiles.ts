// pnpm tsx firebase/functions/src/scripts/tools/syncA8FromFiles.ts --dir=content/a8 --archive-missing
import fs from "fs";
import path from "path";
import crypto from "crypto";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const argv = yargs(hideBin(process.argv))
  .option("dir", { type: "string", default: "content/a8" })
  .option("dry-run", { type: "boolean", default: false })
  .option("archive-missing", { type: "boolean", default: false })
  .parseSync();

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

type Creative = {
  materialId: string;
  type: "text" | "banner";
  label?: string;
  size?: string; // "300x250" など
  href: string; // A8リンク
  imgSrc?: string; // バナーのみ
};

// 既存 InFile に creatives を足す
type InFile = {
  program: { programId?: string; advertiser: string; category?: string[] };
  offer: {
    id?: string;
    title: string;
    description?: string;
    price?: number;
    planType?: "product" | "subscription" | "trial";
    landingUrl: string;
    affiliateUrl?: string;
    images?: string[];
    badges?: string[];
    tags?: string[];
    siteIds?: string[];
    extras?: Record<string, unknown>;
    creatives?: Creative[]; // ← これを追加
  };
};

const hash = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const now = () => Date.now();
const STATE_FILE = path.resolve(".a8-sync-state.json");

type State = { files: Record<string, string> }; // filePath -> sha1
function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { files: {} };
  }
}
function saveState(st: State) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

async function upsert(data: InFile) {
  const t = now();
  const programId =
    data.program.programId ??
    `p_${hash(`${data.program.advertiser}:${data.offer.title}`)}`;
  const dedupeKey = `${programId}:${data.offer.landingUrl}`;
  const offerId = data.offer.id ?? `${programId}:${hash(dedupeKey)}`;

  const programDoc = {
    programId,
    advertiser: data.program.advertiser,
    category: data.program.category ?? ["家電", "レンタル", "サブスク"],
    approval: "approved",
    siteIds: data.offer.siteIds ?? ["kariraku"],
    updatedAt: t,
  };
  const offerDoc = {
    id: offerId,
    programId,
    title: data.offer.title,
    description: data.offer.description ?? "",
    price: data.offer.price,
    planType: data.offer.planType ?? "subscription",
    landingUrl: data.offer.landingUrl,
    affiliateUrl: data.offer.affiliateUrl ?? data.offer.landingUrl,
    images: data.offer.images ?? [],
    badges: data.offer.badges ?? [],
    tags: data.offer.tags ?? [],
    dedupeKey,
    siteIds: data.offer.siteIds ?? ["kariraku"],
    createdAt: t,
    updatedAt: t,
    extras: data.offer.extras ?? {},
    archived: false,
    creatives: data.offer.creatives ?? [], // ←追加
  };

  if (argv["dry-run"]) return { programId, offerId };

  await db
    .collection("programs")
    .doc(programId)
    .set(programDoc, { merge: true });
  await db.collection("offers").doc(offerId).set(offerDoc, { merge: true });
  return { programId, offerId };
}

async function main() {
  const dir = path.resolve(argv.dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const state = loadState();
  const seenOfferIds = new Set<string>();

  for (const f of files) {
    const p = path.join(dir, f);
    const raw = fs.readFileSync(p, "utf-8");
    const h = hash(raw);
    if (state.files[p] === h) {
      /* 変更なしスキップ */ continue;
    }

    const data = JSON.parse(raw) as InFile;
    const { offer } = data;
    const pid =
      data.program.programId ??
      `p_${hash(`${data.program.advertiser}:${offer.title}`)}`;
    const oid = offer.id ?? `${pid}:${hash(`${pid}:${offer.landingUrl}`)}`;
    seenOfferIds.add(oid);

    const res = await upsert(data);
    console.log("Upserted:", f, "->", res.offerId);
    state.files[p] = h;
  }

  // 余っている既存 offers をアーカイブ（オプション）
  if (argv["archive-missing"] && !argv["dry-run"]) {
    const snap = await db.collection("offers").get();
    let archived = 0;
    for (const doc of snap.docs) {
      const o = doc.data();
      if (Array.isArray(o.siteIds) && o.siteIds.includes("kariraku")) {
        if (!seenOfferIds.has(o.id)) {
          await doc.ref.set(
            { archived: true, updatedAt: now() },
            { merge: true }
          );
          archived++;
        }
      }
    }
    if (archived) console.log("Archived offers:", archived);
  }

  if (!argv["dry-run"]) saveState(state);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
