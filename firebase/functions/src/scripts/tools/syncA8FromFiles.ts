import fs from "fs";
import path from "path";
import crypto from "crypto";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const argv = yargs(hideBin(process.argv))
  .option("dir", { type: "string", default: "content/a8" })
  .option("site", { type: "string", demandOption: true }) // ★ 必須
  .option("dry-run", { type: "boolean", default: false })
  .option("archive-missing", { type: "boolean", default: false })
  .parseSync();

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

type Creative = {
  materialId: string;
  type: "text" | "banner";
  label?: string;
  size?: string;
  href: string;
  imgSrc?: string;
};

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
    siteIds?: string[]; // ファイル側に複数書いてあってもOK
    extras?: Record<string, unknown>;
    creatives?: Creative[];
  };
};

const hash = (s: string) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const now = () => Date.now();
const STATE_FILE = path.resolve(".a8-sync-state.json");

type State = { files: Record<string, string> };
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

function ensureUrl(u?: string) {
  if (!u || !/^https?:\/\//.test(u)) throw new Error(`Invalid URL: ${u}`);
  return u;
}

function toNumberOrUndef(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return isFinite(n) ? n : undefined;
}

async function upsert(siteId: string, data: InFile) {
  const t = now();
  const fileSiteIds =
    Array.isArray(data.offer.siteIds) && data.offer.siteIds.length
      ? (data.offer.siteIds as string[])
      : [siteId];

  const programId =
    data.program.programId ??
    `p_${hash(`${data.program.advertiser}:${data.offer.title}`)}`;

  // 同一プラン重複を防ぐためのキー（program × LP URL）
  const dedupeKey = `${programId}:${ensureUrl(data.offer.landingUrl)}`;
  const offerId = data.offer.id ?? `${programId}:${hash(dedupeKey)}`;

  const programDoc = {
    programId,
    advertiser: data.program.advertiser,
    category: data.program.category ?? ["家電", "レンタル", "サブスク"],
    approval: "approved",
    siteIds: Array.from(new Set([...fileSiteIds, siteId])), // ★ 取りこぼし防止
    siteIdPrimary: siteId, // ★ 1サイト検索を速くするための単独キー
    updatedAt: t,
    createdAt: t,
  };

  const offerDoc = {
    id: offerId,
    programId,
    title: data.offer.title,
    description: data.offer.description ?? "",
    price: toNumberOrUndef(data.offer.price),
    planType: data.offer.planType ?? "subscription",
    landingUrl: ensureUrl(data.offer.landingUrl),
    affiliateUrl: ensureUrl(data.offer.affiliateUrl ?? data.offer.landingUrl),
    images: data.offer.images ?? [],
    badges: data.offer.badges ?? [],
    tags: data.offer.tags ?? [],
    dedupeKey,
    siteIds: Array.from(new Set([...fileSiteIds, siteId])),
    siteIdPrimary: siteId, // ★ 単独キー
    priority: 1,
    status: "active",
    archived: false,
    creatives: data.offer.creatives ?? [],
    extras: data.offer.extras ?? {},
    updatedAt: t,
    createdAt: t,
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
  const siteId = argv.site as string;
  const dir = path.resolve(argv.dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const state = loadState();
  const seenOfferIds = new Set<string>();

  for (const f of files) {
    const p = path.join(dir, f);
    const raw = fs.readFileSync(p, "utf-8");
    const h = hash(raw);

    // 変更なしはスキップ（差分同期）
    if (state.files[p] === h) continue;

    const data = JSON.parse(raw) as InFile;

    // 先に offerId を確定して seen に登録（archive 用）
    const pid =
      data.program.programId ??
      `p_${hash(`${data.program.advertiser}:${data.offer.title}`)}`;
    const oid =
      data.offer.id ?? `${pid}:${hash(`${pid}:${data.offer.landingUrl}`)}`;
    seenOfferIds.add(oid);

    const res = await upsert(siteId, data);
    console.log("Upserted:", f, "->", res.offerId);
    state.files[p] = h;
  }

  // 指定サイトに属する既存 offers で、今回ファイル一覧に見当たらないものをアーカイブ
  if (argv["archive-missing"] && !argv["dry-run"]) {
    const snap = await db
      .collection("offers")
      .where("siteIds", "array-contains", siteId)
      .get();

    let archived = 0;
    for (const doc of snap.docs) {
      const o = doc.data();
      if (!seenOfferIds.has(o.id) && !o.archived) {
        await doc.ref.set(
          { archived: true, updatedAt: now() },
          { merge: true }
        );
        archived++;
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
