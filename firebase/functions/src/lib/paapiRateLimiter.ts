import { getFirestore } from "firebase-admin/firestore";

type LeaseOpts = {
  keySuffix?: string; // 例: "JP" / "US"
  tps?: number; // 1秒あたり許容量（既定 1）※下限0.1まで許容
  burst?: number; // バースト（既定 5）
  tpdMax?: number; // 日次上限（既定 8640）
};

function nextMidnightUTC(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );
  return next.getTime();
}

/** Firestore 協調レートリミッタ（TPS/バースト/日次上限） */
export async function leaseToken(opts: LeaseOpts = {}): Promise<void> {
  const db = getFirestore();

  // ★ 下限を 0.1 TPS まで許容（従来は 1 に固定）
  const tps = Math.max(0.1, Number(process.env.PAAPI_TPS ?? opts.tps ?? 1));
  const burst = Math.max(1, Number(process.env.PAAPI_BURST ?? opts.burst ?? 5));
  const tpdMax = Math.max(
    1,
    Number(process.env.PAAPI_TPD ?? opts.tpdMax ?? 8640)
  );
  const fillMs = Math.max(100, Math.floor(1000 / tps));

  const key = `paapi:${opts.keySuffix ?? "JP"}`;
  const ref = db.collection("rateLimits").doc(key);
  const tpdRef = db.collection("rateLimits").doc(`${key}:tpd`);

  for (;;) {
    const result = await db.runTransaction(async (tx) => {
      const now = Date.now();

      // --- トークン（TPS） ---
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as any) : {};
      let tokens = Number.isFinite(data?.tokens) ? Number(data.tokens) : burst;
      let lastRefillAt = Number.isFinite(data?.lastRefillAt)
        ? Number(data.lastRefillAt)
        : now;

      const add = Math.floor((now - lastRefillAt) / fillMs);
      if (add > 0) {
        tokens = Math.min(burst, tokens + add);
        lastRefillAt = now;
      }

      // --- 日次上限（TPD） ---
      const tpdSnap = await tx.get(tpdRef);
      const tpdData = tpdSnap.exists ? (tpdSnap.data() as any) : {};
      let remaining = Number.isFinite(tpdData?.remaining)
        ? Number(tpdData.remaining)
        : tpdMax;
      let resetAt = Number.isFinite(tpdData?.resetAt)
        ? Number(tpdData.resetAt)
        : nextMidnightUTC();

      if (now >= resetAt) {
        remaining = tpdMax;
        resetAt = nextMidnightUTC();
      }

      if (remaining <= 0) {
        tx.set(tpdRef, { remaining: 0, resetAt }, { merge: true });
        return { waitMs: Number.POSITIVE_INFINITY };
      }

      if (tokens <= 0) {
        const wait = Math.max(
          50,
          fillMs - ((now - lastRefillAt) % fillMs || 0)
        );
        tx.set(ref, { tokens: 0, lastRefillAt }, { merge: true });
        return { waitMs: wait };
      }

      tokens -= 1;
      remaining -= 1;
      tx.set(ref, { tokens, lastRefillAt }, { merge: true });
      tx.set(tpdRef, { remaining, resetAt }, { merge: true });

      return { waitMs: 0 };
    });

    if (!Number.isFinite(result.waitMs)) {
      const err: any = new Error("RATE_TPD_EXHAUSTED");
      err.resetAt = nextMidnightUTC();
      throw err;
    }
    if (result.waitMs <= 0) return;
    await new Promise((r) => setTimeout(r, result.waitMs));
  }
}
