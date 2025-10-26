// firebase/functions/src/lib/pickers/monitored.ts
import { Firestore } from "firebase-admin/firestore";

type Monitored = {
  productId?: string;
  productName?: string;
  imageUrl?: string | null;
  updatedAt?: number;
  price?: number | null;
  tags?: string[];
  pains?: string[];
};

const DAY = 24 * 60 * 60 * 1000;

export async function pickHotCandidate(siteId: string, db: Firestore) {
  // 直近の候補を広めに拾う
  const snap = await db
    .collection("sites")
    .doc(siteId)
    .collection("monitoredItems")
    .orderBy("updatedAt", "desc")
    .limit(200)
    .get();

  if (snap.empty) return null;

  // 価格履歴は簡易：bestPrice 相当があればそこから
  // ここでは monitored の price を利用（なければ0扱い）
  const now = Date.now();
  let best: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let bestScore = -1;

  for (const d of snap.docs) {
    const p = d.data() as Monitored;
    const updatedAt = p.updatedAt ?? 0;

    // --- 基本スコア ---
    let score = 0;

    // 1) 新規性（30）
    const recencyDays = Math.max(0, (now - updatedAt) / DAY);
    const recencyScore = Math.max(0, 30 - Math.floor(recencyDays * 10)); // 0〜3日で滑らかに減衰
    score += recencyScore;

    // 2) 価格インパクト（30）※超簡易：1,980/2,980/4,980あたりが伸びやすいので近似で加点
    const price = typeof p.price === "number" ? p.price : null;
    if (price != null) {
      const attractors = [1980, 2980, 4980, 9980, 14800, 19800];
      const deltas = attractors.map((a) => Math.abs(price - a));
      const bestDelta = Math.min(...deltas);
      // 近いほど加点（～±300円で最大）
      const priceScore = Math.max(0, 30 - Math.floor(bestDelta / 10)); // 300円差≈0点
      score += Math.min(priceScore, 30);
    }

    // 3) タグ/悩み整合（20）
    const tags = Array.isArray(p.tags) ? p.tags : [];
    const pains = Array.isArray(p.pains) ? p.pains : [];
    const tagHits = tags.length + pains.length;
    score += Math.min(20, tagHits * 5); // 0,5,10,15,20…

    // 4) 画像あり（10）
    if (p.imageUrl) score += 10;

    // 6) ノイズ（±5）
    score += Math.floor(Math.random() * 11) - 5;

    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }

  return best;
}

// 既存互換：最近更新・最近作成の単純版（必要なら残す）
export async function pickRecentUpdated(siteId: string, db: Firestore) {
  const snap = await db
    .collection("sites")
    .doc(siteId)
    .collection("monitoredItems")
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();
  return snap.docs[0] ?? null;
}

export async function pickRecentCreated(siteId: string, db: Firestore) {
  const snap = await db
    .collection("sites")
    .doc(siteId)
    .collection("monitoredItems")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  return snap.docs[0] ?? null;
}
