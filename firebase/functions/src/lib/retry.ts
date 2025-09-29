// firebase/functions/src/lib/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 3,
  baseDelayMs = 500
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const status = e?.status ?? e?.response?.status;
      const msg = String(e?.message ?? "") + String(e?.response?.text ?? "");
      const retriable =
        status === 429 ||
        (typeof status === "number" && status >= 500 && status < 600) ||
        /Throttl|TooMany|Limit/i.test(msg);
      if (!retriable || i === tries - 1) throw last;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw last;
}
