// apps/web/lib/products.ts
import {
  collection,
  getDocs,
  limit as qLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type QueryConstraint,
  type Firestore, // ← 追加（なくてもOKだが補助用）
} from "firebase/firestore";
import type { Product } from "@affiscope/shared-types";
import { getDb, productConverter } from "./firebase";

export type SortKey = "price" | "createdAt";
export type SortOrder = "asc" | "desc";

export interface FetchParams {
  siteId: string;
  categoryId: string;
  brand?: string;
  sortBy: "price" | "createdAt";
  order: "asc" | "desc";
  pageSize?: number;
  cursor?: DocumentSnapshot<Product>;
}

export async function fetchProducts(params: FetchParams): Promise<{
  items: Product[];
  nextCursor?: DocumentSnapshot<Product>;
}> {
  const {
    siteId,
    categoryId,
    brand,
    sortBy,
    order,
    pageSize = 24,
    cursor,
  } = params;

  // ★ getDb() の null をガードして Firestore 型に絞る
  const db = getDb();
  if (!db) {
    // SSR/ビルド時に直呼びされない想定だが、型のために明示
    throw new Error(
      "Firestore has not been initialized (getDb returned null)."
    );
  }
  const col = collection(db, "products").withConverter(productConverter);

  const constraints: QueryConstraint[] = [
    where("siteId", "==", siteId),
    where("categoryId", "==", categoryId),
  ];
  if (brand) constraints.push(where("brand", "==", brand));

  constraints.push(
    sortBy === "price"
      ? orderBy("bestPrice.price", order)
      : orderBy("createdAt", order),
    qLimit(pageSize)
  );
  if (cursor) constraints.push(startAfter(cursor));

  const qs = query(col, ...constraints);
  const snap = await getDocs(qs);

  const items = snap.docs.map((d) => d.data());
  const nextCursor =
    snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : undefined;

  return { items, nextCursor };
}

export async function fetchBrands(
  siteId: string,
  categoryId: string,
  sampleSize = 200
): Promise<string[]> {
  const { items } = await fetchProducts({
    siteId,
    categoryId,
    sortBy: "createdAt",
    order: "desc",
    pageSize: sampleSize,
  });

  const set = new Set<string>();
  for (const p of items) if (p.brand) set.add(p.brand);
  return Array.from(set).sort();
}
