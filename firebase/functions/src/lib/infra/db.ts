import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

// アプリは一度だけ初期化
if (getApps().length === 0) {
  initializeApp();
}

// Firestore のシングルトンを安全に共有（再バンドルでも重複しない）
declare global {
  // eslint-disable-next-line no-var
  var __AFFISCOPE_DB__: Firestore | undefined;
}

export const db: Firestore =
  globalThis.__AFFISCOPE_DB__ ?? (globalThis.__AFFISCOPE_DB__ = getFirestore());

// ※ settings() は呼ばない（呼ぶなら「最初に一回だけ＆他の操作より前」である保証が必要）
