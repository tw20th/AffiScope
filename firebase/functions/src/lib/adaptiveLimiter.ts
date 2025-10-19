// 適応レートリミッタ（429が出たら待機時間を増やし、成功で少しずつ縮める）
// 単一プロセス内で有効。Cloud Functions の同時実行でも保守的に動くよう直列化します。

type Options = {
  minWaitMs: number; // 下限
  maxWaitMs: number; // 上限
  stepUp: number; // 429時の倍率
  stepDown: number; // 成功時の縮小倍率
  jitterMs?: number; // ±ランダム(ミリ秒)で衝突回避
};

export function createAdaptiveLimiter(opts: Options) {
  let waitMs = Math.max(0, opts.minWaitMs);
  let nextAt = 0;
  let inflight: Promise<void> = Promise.resolve();

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function schedule(): Promise<void> {
    // 直列化：前回の実行予約が終わるまで待つ
    await inflight.catch(() => {});
    inflight = (async () => {
      const now = Date.now();
      const wait = nextAt > now ? nextAt - now : 0;
      if (wait > 0) await sleep(wait);

      const jitter = opts.jitterMs
        ? (Math.random() * 2 - 1) * opts.jitterMs
        : 0;
      nextAt = Date.now() + Math.max(0, Math.round(waitMs + jitter));
    })();
    await inflight;
  }

  function note429(): void {
    waitMs = Math.min(opts.maxWaitMs, Math.ceil(waitMs * opts.stepUp));
  }
  function noteSuccess(): void {
    waitMs = Math.max(opts.minWaitMs, Math.floor(waitMs * opts.stepDown));
  }
  function getState() {
    return { waitMs, nextAt };
  }

  return { schedule, note429, noteSuccess, getState };
}

// 10件バッチ向けの下限に調整（まずは 900ms で様子見）
export const adaptivePaapiLimiter = createAdaptiveLimiter({
  minWaitMs: 10000, // ★ 10秒
  maxWaitMs: 30000,
  stepUp: 2.0,
  stepDown: 0.9,
  jitterMs: 300,
});
