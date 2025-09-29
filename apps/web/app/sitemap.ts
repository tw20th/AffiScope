// apps/web/app/sitemap.ts
import type { MetadataRoute } from "next";
import { getApps, initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  limit,
  getDocs,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

// Web SDK を初期化（既に初期化済みでもOK）
function initFirebase() {
  if (getApps().length === 0) {
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    });
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  initFirebase();
  const db = getFirestore();

  const baseUrl = "https://www.chairscope.com";
  const out: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date() },
    { url: `${baseUrl}/products`, lastModified: new Date() },
  ];

  // published blogs だけ収集（必要に応じて siteId 条件も追加可）
  const blogsRef = collection(db, "blogs");
  const q = query(blogsRef, where("status", "==", "published"), limit(5000));
  const snap = await getDocs(q);

  snap.docs.forEach((doc: QueryDocumentSnapshot) => {
    const d = doc.data() as any;
    out.push({
      url: `${baseUrl}/blog/${doc.id}`,
      lastModified: new Date(d.updatedAt || Date.now()),
      changeFrequency: "daily",
      priority: 0.8,
    });
  });

  return out;
}
