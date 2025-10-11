// firebase/functions/src/lib/paapiRateLimiter.ts
import { getFirestore } from "firebase-admin/firestore";
const KEY = "paapiJP";
const FILL_MS = 1000; // 1TPS
const CAPACITY = 5; // 軽いバースト

export async function leaseToken(): Promise<void> {
  const db = getFirestore();
  const ref = db.collection("rateLimits").doc(KEY);

  await db
    .runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const data = snap.exists ? (snap.data() as any) : {};
      let tokens = Number.isFinite(data?.tokens)
        ? Number(data.tokens)
        : CAPACITY;
      let last = Number.isFinite(data?.lastRefillAt)
        ? Number(data.lastRefillAt)
        : now;

      const add = Math.floor((now - last) / FILL_MS);
      if (add > 0) {
        tokens = Math.min(CAPACITY, tokens + add);
        last = now;
      }

      if (tokens <= 0) {
        const wait = Math.max(50, FILL_MS - ((now - last) % FILL_MS || 0));
        tx.set(ref, { tokens: 0, lastRefillAt: last }, { merge: true });
        throw Object.assign(new Error("RATE_WAIT"), { wait });
      }

      tokens -= 1;
      tx.set(ref, { tokens, lastRefillAt: last }, { merge: true });
    })
    .catch(async (e: any) => {
      if (e?.message === "RATE_WAIT") {
        await new Promise((r) => setTimeout(r, e.wait));
        return leaseToken();
      }
      throw e;
    });
}
