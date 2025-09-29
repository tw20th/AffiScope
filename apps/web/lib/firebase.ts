// apps/web/lib/firebase.ts
// ※ サーバーから import されても絶対に例外を投げない実装に変更
import type { Firestore, FirestoreDataConverter } from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";
import type { Product } from "@affiscope/shared-types";

let appSingleton: FirebaseApp | null = null;
let dbSingleton: Firestore | null = null;

// 環境変数（NEXT_PUBLIC_FB_* を使用）
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FB_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
};

// クライアント判定
const isBrowser = typeof window !== "undefined";

/** クライアントでのみ Firebase App を初期化（サーバーなら null を返す） */
export function getApp(): FirebaseApp | null {
  if (!isBrowser) return null;
  if (appSingleton) return appSingleton;

  // 動的 import にして SSR バンドル時の副作用を回避
  const { getApps, initializeApp } =
    require("firebase/app") as typeof import("firebase/app");
  appSingleton = getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig as any);
  return appSingleton;
}

/** Firestore を取得（クライアントのみ）。サーバーなら null を返す。 */
export function getDb(): Firestore | null {
  if (!isBrowser) return null;
  if (dbSingleton) return dbSingleton;

  const app = getApp();
  if (!app) return null;

  const { getFirestore } =
    require("firebase/firestore") as typeof import("firebase/firestore");
  dbSingleton = getFirestore(app);
  return dbSingleton;
}

/** number | Timestamp | undefined を number に */
export const numOrTsToNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  try {
    // optional: Timestamp が無ければそのまま
    const { Timestamp } =
      require("firebase/firestore") as typeof import("firebase/firestore");
    if (v instanceof Timestamp) return v.toMillis();
  } catch {}
  return Date.now();
};

// ---- Converter（クライアント専用の変換ロジック。サーバーから参照しても安全） ----
export const productConverter: FirestoreDataConverter<Product> = {
  toFirestore(p: Product) {
    // serverTimestamp はクライアントでだけ解決
    try {
      const { serverTimestamp } =
        require("firebase/firestore") as typeof import("firebase/firestore");
      const { asin, ...rest } = p;
      return {
        ...rest,
        createdAt: p.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
    } catch {
      // サーバーで呼ばれた場合は素通し（値は後で上書きされる想定）
      const { asin, ...rest } = p;
      return rest as any;
    }
  },
  fromFirestore(snapshot) {
    const data = snapshot.data() as any;
    const bestPrice = data.bestPrice
      ? {
          price: Number(data.bestPrice.price),
          source: data.bestPrice.source as "amazon" | "rakuten",
          url: String(data.bestPrice.url),
          updatedAt: numOrTsToNumber(data.bestPrice.updatedAt),
        }
      : undefined;

    const product: Product = {
      asin: snapshot.id,
      title: data.title ?? "",
      brand: data.brand ?? undefined,
      imageUrl: data.imageUrl ?? undefined,
      categoryId: data.categoryId,
      siteId: data.siteId,
      tags: Array.isArray(data.tags) ? data.tags : [],
      specs: data.specs ?? undefined,
      offers: Array.isArray(data.offers) ? data.offers : [],
      bestPrice,
      priceHistory: Array.isArray(data.priceHistory) ? data.priceHistory : [],
      aiSummary: data.aiSummary ?? undefined,
      views: typeof data.views === "number" ? data.views : 0,
      createdAt: numOrTsToNumber(data.createdAt),
      updatedAt: numOrTsToNumber(data.updatedAt),
    };
    return product;
  },
};

/** ドキュメント存在チェック（サーバーなら false） */
export async function existsDoc(path: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { doc, getDoc } =
    require("firebase/firestore") as typeof import("firebase/firestore");
  const snap = await getDoc(doc(db, path));
  return snap.exists();
}

export function getFs() {
  // 常に同じ require インスタンスを返す
  return require("firebase/firestore") as typeof import("firebase/firestore");
}
