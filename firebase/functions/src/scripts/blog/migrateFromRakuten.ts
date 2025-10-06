/* eslint-disable no-console */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

/** ---------- types ---------- */
type JsonLd = Record<string, unknown>;
type SrcTimestamp = Timestamp | number | string | undefined;

interface SrcBlog {
  title?: string;
  content?: string;
  imageUrl?: string;
  imageUrlOG?: string;
  jsonLd?: JsonLd[];
  category?: string;
  tags?: string[];
  siteKey?: string;
  relatedItemCode?: string;
  slug: string;
  status?: "published" | "draft";
  createdAt?: SrcTimestamp;
  updatedAt?: SrcTimestamp;
  publishedAt?: SrcTimestamp;
  views?: number;
}

interface DestBlog {
  title: string;
  content: string;
  imageUrl?: string | null;
  ogImageUrl?: string | null;
  jsonLd?: JsonLd[] | null;
  tags: string[];
  siteId: string;
  relatedAsin?: string | null;
  slug: string;
  status: "published" | "draft";
  createdAt: number;
  updatedAt: number;
  publishedAt: number;
  lastPublishedAt?: number;
  views: number;
}

/** ---------- utils ---------- */
function toMs(v: SrcTimestamp, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? fallback : t;
  }
  if (v instanceof Timestamp) return v.toMillis();
  return fallback;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete obj[k];
    }
  }
  return obj;
}

/** ---------- main ---------- */
async function main(): Promise<void> {
  const {
    SRC_PROJECT_ID,
    DEST_PROJECT_ID,
    SRC_COLLECTION = "blogs",
    DEST_COLLECTION = "blogs",
    DEST_SITE_ID = "chairscope",
    USE_SLUG_AS_ID = "true",
    DRY_RUN = "false",
  } = process.env;

  if (!SRC_PROJECT_ID || !DEST_PROJECT_ID) {
    console.error("Set env: SRC_PROJECT_ID, DEST_PROJECT_ID");
    process.exit(1);
  }

  // 2つのアプリ（ソース/デスティネーション）を初期化
  const srcApp = initializeApp(
    { projectId: SRC_PROJECT_ID, credential: applicationDefault() },
    "src"
  );
  const destApp = initializeApp(
    { projectId: DEST_PROJECT_ID, credential: applicationDefault() },
    "dest"
  );

  const srcDb = getFirestore(srcApp);
  const destDb = getFirestore(destApp);

  // Firestore: undefined を無視（安全側）
  srcDb.settings({ ignoreUndefinedProperties: true });
  destDb.settings({ ignoreUndefinedProperties: true });

  // 取得（必要なら where("status", "in", ["published","draft"]) など調整）
  const snap = await srcDb.collection(SRC_COLLECTION).get();
  console.log(
    `source: ${SRC_PROJECT_ID}/${SRC_COLLECTION} -> found ${snap.size} docs`
  );

  let migrated = 0;
  for (const d of snap.docs) {
    const s = d.data() as SrcBlog;

    const slug = (s.slug || "").trim();
    if (!slug) {
      console.warn(`[skip] doc ${d.id} has no slug`);
      continue;
    }

    // 日時はソース値を維持（未定義は createdAt→now）
    const now = Date.now();
    const createdAt = toMs(s.createdAt, now);
    const updatedAt = toMs(s.updatedAt, createdAt); // ← 触らない方針
    const publishedAt = toMs(s.publishedAt, createdAt);

    // タグに category を吸収
    const tags = unique([
      ...(s.tags ?? []),
      ...(s.category ? [s.category] : []),
    ]);

    const payload: DestBlog = pruneUndefined({
      title: s.title ?? "(no title)",
      content: s.content ?? "",
      imageUrl: s.imageUrl ?? null,
      ogImageUrl: s.imageUrlOG ?? null,
      jsonLd: s.jsonLd ?? null,
      tags,
      siteId: DEST_SITE_ID,
      relatedAsin: null,
      slug,
      status: s.status ?? "published",
      createdAt,
      updatedAt, // ← SEO上ここは保持
      publishedAt,
      lastPublishedAt: updatedAt,
      views: typeof s.views === "number" ? s.views : 0,
    });

    const destRef =
      USE_SLUG_AS_ID === "true"
        ? destDb.collection(DEST_COLLECTION).doc(slug)
        : destDb.collection(DEST_COLLECTION).doc();

    if (DRY_RUN === "true") {
      console.log(`[dry-run] would upsert: ${destRef.path}`, {
        slug,
        updatedAt,
      });
      migrated++;
      continue;
    }

    // 既存があれば views は大きい方を維持
    const existing = await destRef.get();
    if (existing.exists) {
      const cur = existing.data() as Partial<DestBlog> | undefined;
      const currentViews = typeof cur?.views === "number" ? cur.views : 0;
      (payload as DestBlog).views = Math.max(currentViews, payload.views);
    }

    await destRef.set(payload, { merge: false });
    console.log(`[ok] upserted: ${destRef.path}`);
    migrated++;
  }

  console.log(`done. migrated=${migrated}/${snap.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
