/* eslint-disable no-console */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as fs from "node:fs";
import * as path from "node:path";

/** ---------- types ---------- */
type JsonLd = Record<string, unknown>;

interface SiteConfig {
  siteId: string;
  displayName?: string;
  domain?: string;
  brand?: {
    logoUrl?: string;
    primary?: string;
    accent?: string;
    theme?: "light" | "dark";
  };
  // 他の項目があってもOK（無視されます）
}

interface BlogDoc {
  title?: string;
  content?: string;
  imageUrl?: string | null;
  ogImageUrl?: string | null;
  jsonLd?: JsonLd[] | null;
  tags?: string[];
  category?: string;
  siteId?: string;
  slug: string;
  status?: "published" | "draft";
  createdAt?: number | string | Timestamp;
  updatedAt?: number | string | Timestamp;
  publishedAt?: number | string | Timestamp;
  lastPublishedAt?: number | string | Timestamp;
  views?: number;
}

/** ---------- utils ---------- */
function asMs(
  v: number | string | Timestamp | undefined,
  fallback: number
): number {
  if (v == null) return fallback;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? fallback : t;
  }
  if (v instanceof Timestamp) return v.toMillis();
  return fallback;
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

function readSiteConfig(
  onlySiteId: string | undefined,
  explicitPath?: string
): SiteConfig | null {
  try {
    if (explicitPath) {
      const p = path.resolve(explicitPath);
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, "utf8")) as SiteConfig;
        return j;
      }
      return null;
    }
    if (!onlySiteId) return null;
    // 既定の探索場所：repo内の sites/<siteId>.json
    const guess =
      path.resolve(process.cwd(), `src/../sites/${onlySiteId}.json`) ||
      // fallback（よくあるパス）:
      path.resolve(process.cwd(), `sites/${onlySiteId}.json`);
    const candidates = [
      path.resolve(process.cwd(), `sites/${onlySiteId}.json`),
      path.resolve(process.cwd(), `src/../sites/${onlySiteId}.json`),
      path.resolve(process.cwd(), `../../sites/${onlySiteId}.json`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, "utf8")) as SiteConfig;
        return j;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildArticleJsonLd(input: {
  domain: string;
  slug: string;
  title: string;
  description: string;
  image?: string | null;
  datePublished: number;
  dateModified: number;
  authorName: string;
  publisherName?: string;
  publisherLogo?: string;
}): JsonLd {
  const url = `https://${input.domain}/blog/${input.slug}`;
  const imageList = input.image ? [input.image] : undefined;

  const jsonLd: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    mainEntityOfPage: url,
    headline: input.title,
    description: input.description,
    image: imageList,
    author: { "@type": "Person", name: input.authorName },
    datePublished: new Date(input.datePublished).toISOString(),
    dateModified: new Date(input.dateModified).toISOString(),
  };

  // publisher は任意だが、サイトのブランドを出せるとGood
  if (input.publisherName) {
    (jsonLd as any).publisher = pruneUndefined({
      "@type": "Organization",
      name: input.publisherName,
      logo: input.publisherLogo
        ? { "@type": "ImageObject", url: input.publisherLogo }
        : undefined,
    });
  }

  return pruneUndefined(jsonLd);
}

/** ---------- main ---------- */
async function main(): Promise<void> {
  const {
    PROJECT_ID,
    COLLECTION = "blogs",
    // ⬇ この2つは「必須」扱い（サイトごと運用の安全装置）
    ONLY_SITE_ID,
    DOMAIN,
    // オプション（サイト定義ファイルの明示パス。未指定なら sites/<siteId>.json を自動探索）
    SITE_CONFIG_PATH,
    // dry-run フラグ
    DRY_RUN = "false",
  } = process.env;

  if (!PROJECT_ID) {
    console.error("Set env: PROJECT_ID");
    process.exit(1);
  }
  if (!ONLY_SITE_ID) {
    console.error(
      "Set env: ONLY_SITE_ID (サイト単位での再生成を強制しています)"
    );
    process.exit(1);
  }

  // サイト設定の読込（publisher名やロゴ・既定domainに利用）
  const siteConf = readSiteConfig(ONLY_SITE_ID, SITE_CONFIG_PATH) || {
    siteId: ONLY_SITE_ID,
  };
  const publisherName = siteConf.displayName || ONLY_SITE_ID;
  const publisherLogo = siteConf.brand?.logoUrl;
  const domain = DOMAIN || siteConf.domain;
  if (!domain) {
    console.error("Set env: DOMAIN or specify domain in site config file.");
    process.exit(1);
  }

  // Firestore 初期化
  initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  // siteId で明確に絞る（安全運用の要）
  const queryRef = db
    .collection(COLLECTION)
    .where("siteId", "==", ONLY_SITE_ID);
  const snap = await queryRef.get();

  console.log(
    `target: ${PROJECT_ID}/${COLLECTION} (siteId=${ONLY_SITE_ID}, domain=${domain}) -> ${snap.size} docs`
  );

  let normalized = 0;

  for (const d of snap.docs) {
    const b = d.data() as BlogDoc;

    // 「触らない」: slug / updatedAt
    const now = Date.now();
    const createdAt = asMs(b.createdAt, now);
    const updatedAt = asMs(b.updatedAt, createdAt);
    const publishedAt = asMs(b.publishedAt, createdAt);
    const lastPublishedAt = asMs(b.lastPublishedAt, updatedAt);

    // 簡易 summary（先頭160文字）
    const raw = (b.content ?? "").replace(/\s+/g, " ").trim();
    const summary = raw.slice(0, 160) || (b.title ?? "");

    const jsonLd: JsonLd[] = [
      buildArticleJsonLd({
        domain,
        slug: b.slug,
        title: b.title ?? "(no title)",
        description: summary,
        image: b.ogImageUrl || b.imageUrl || null,
        datePublished: publishedAt,
        dateModified: updatedAt,
        authorName: ONLY_SITE_ID, // 著者名はsiteIdで簡易表記（好みで変更可）
        publisherName, // サイト表示名
        publisherLogo, // サイトのロゴ（ある場合）
      }),
    ];

    const patch = pruneUndefined<
      Partial<BlogDoc> & {
        jsonLd: JsonLd[];
        lastPublishedAt: number;
        createdAt: number;
        publishedAt: number;
      }
    >({
      // siteId は既存を尊重（変更しない）
      createdAt,
      // updatedAt は上書きしない
      publishedAt,
      lastPublishedAt,
      jsonLd,
    });

    if (DRY_RUN === "true") {
      console.log(`[dry-run] ${d.ref.path}`, {
        keep: { slug: b.slug, updatedAt },
        patch,
      });
      normalized++;
      continue;
    }

    await d.ref.set(patch, { merge: true });
    console.log(`[ok] normalized: ${d.ref.path}`);
    normalized++;
  }

  console.log(`done. normalized=${normalized}/${snap.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
