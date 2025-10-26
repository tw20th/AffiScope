// firebase/functions/src/lib/admin.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 解析時に落ちないよう最小限の初期化
if (!getApps().length) {
  initializeApp();
}

export const db = getFirestore();
