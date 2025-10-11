// firebase/functions/src/lib/staleness.ts
export type FreshPolicy = "hot" | "warm" | "cold";

export function computeFreshFor(policy: FreshPolicy, now = Date.now()): number {
  const minutes = policy === "hot" ? 30 : policy === "warm" ? 6 * 60 : 24 * 60;
  return now + minutes * 60 * 1000;
}

export function pickPolicy(views: number, pinned = false): FreshPolicy {
  if (pinned) return "hot";
  if (views >= 100) return "hot";
  if (views >= 20) return "warm";
  return "cold";
}

export function isStale(freshUntil?: number, now = Date.now()): boolean {
  return !freshUntil || now >= freshUntil;
}
