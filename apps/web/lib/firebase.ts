// apps/web/lib/firebase.ts
"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  type Firestore,
  serverTimestamp,
  Timestamp,
  type FirestoreDataConverter,
  doc,
  getDoc,
} from "firebase/firestore";
import type { Product } from "@affiscope/shared-types";
import { SITE_ID } from "./site";

let appSingleton: FirebaseApp | undefined;
let dbSingleton: Firestore | undefined;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FB_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
};

export function getApp(): FirebaseApp {
  if (!appSingleton) {
    appSingleton = getApps().length
      ? getApps()[0]
      : initializeApp(firebaseConfig);
  }
  return appSingleton;
}

/** ブラウザ専用 */
export function getDb(): Firestore {
  if (typeof window === "undefined") {
    throw new Error(
      "getDb() must be called in the browser (client components)."
    );
  }
  if (!dbSingleton) {
    dbSingleton = getFirestore(getApp());
  }
  return dbSingleton;
}

// ※ db の即時初期化は置かない

export const numOrTsToNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v instanceof Timestamp) return v.toMillis();
  return Date.now();
};

export const productConverter: FirestoreDataConverter<Product> = {
  toFirestore(p: Product) {
    const { asin, ...rest } = p;
    return {
      ...rest,
      createdAt: p.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
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
      siteId: data.siteId ?? SITE_ID,
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

export async function existsDoc(path: string): Promise<boolean> {
  const snapshot = await getDoc(doc(getDb(), path));
  return snapshot.exists();
}
