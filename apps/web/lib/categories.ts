import type { Firestore } from "firebase/firestore";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import type { Category } from "@affiscope/shared-types";

export async function fetchCategoryBySlug(
  db: Firestore,
  siteId: string,
  slug: string
) {
  const q = query(
    collection(db, "categories"),
    where("siteId", "==", siteId),
    where("slug", "==", slug),
    limit(1)
  );
  const snap = await getDocs(q);
  return (snap.docs[0]?.data() as Category | undefined) ?? undefined;
}

export async function fetchBreadcrumbs(
  db: Firestore,
  siteId: string,
  current?: Category
) {
  if (!current) return [];
  const slugs = [...(current.path || []), current.slug].slice(-10); // IN は最大10
  const q = query(
    collection(db, "categories"),
    where("siteId", "==", siteId),
    where("slug", "in", slugs)
  );
  const snap = await getDocs(q);
  const map = new Map(
    snap.docs.map((d) => [(d.data() as Category).slug, d.data() as Category])
  );
  const ordered = [...(current.path || []), current.slug]
    .map((s) => map.get(s))
    .filter(Boolean) as Category[];
  return ordered;
}

export async function fetchSiblings(
  db: Firestore,
  siteId: string,
  current?: Category
) {
  const parentId = current?.parentId ?? null;
  const q = query(
    collection(db, "categories"),
    where("siteId", "==", siteId),
    where("parentId", "==", parentId), // ← 修正ポイント
    orderBy("order", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Category);
}
