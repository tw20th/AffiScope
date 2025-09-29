// firebase/functions/src/upsert/upsertProduct.ts
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

export type SeedInput = {
  asin: string;
  siteId: string;
  categoryId: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  price?: number; // 任意
  url?: string; // 任意
};

// ---- Firestore 初期化 ----
let _store: FirebaseFirestore.Firestore | null = null;
function db(): FirebaseFirestore.Firestore {
  if (admin.apps.length === 0) admin.initializeApp();
  if (!_store) _store = getFirestore();
  return _store;
}

// ---- undefined を落とすユーティリティ ----
function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * シード／単発登録用の Upsert
 * - ドキュメントIDは `${siteId}_${asin}` に統一
 * - 価格とURLが揃っている場合のみ offers/bestPrice/priceHistory を作成
 */
export async function upsertProductSeed(i: SeedInput): Promise<void> {
  const store = db();
  const docId = `${i.siteId}_${i.asin}`;
  const ref = store.collection("products").doc(docId);
  const snap = await ref.get();
  const now = Date.now();

  const existing = (snap.data() as { createdAt?: number } | undefined) ?? {};
  const createdAt =
    typeof existing.createdAt === "number" ? existing.createdAt : now;

  const base = pruneUndefined({
    asin: i.asin,
    siteId: i.siteId,
    categoryId: i.categoryId,
    title: i.title ?? `商品 ${i.asin}`,
    brand: i.brand,
    imageUrl: i.imageUrl,
    tags: [] as string[],
    views: 0,
  });

  const hasPrice = typeof i.price === "number" && i.url;

  const offers = hasPrice
    ? [
        {
          source: "amazon" as const,
          price: i.price as number,
          url: i.url as string,
          lastSeenAt: now,
        },
      ]
    : undefined;

  const bestPrice = hasPrice
    ? {
        price: i.price as number,
        source: "amazon" as const,
        url: i.url as string,
        updatedAt: now,
      }
    : undefined;

  const priceHistory = hasPrice
    ? ([
        {
          ts: now,
          source: "amazon" as const,
          price: i.price as number,
        },
      ] as Array<{ ts: number; source: "amazon" | "rakuten"; price: number }>)
    : ([] as
        | Array<{ ts: number; source: "amazon" | "rakuten"; price: number }>
        | undefined);

  const payload = pruneUndefined({
    ...base,
    offers,
    bestPrice,
    // priceHistory は undefined でも OK（既存保持）
    priceHistory,
    createdAt,
    updatedAt: now,
  });

  await ref.set(payload, { merge: true });
}
