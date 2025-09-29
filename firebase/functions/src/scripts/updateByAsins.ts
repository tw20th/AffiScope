// firebase/functions/src/scripts/updateByAsins.ts
try {
  if (process.env.FUNCTIONS_EMULATOR || !process.env.K_SERVICE) {
    await import("dotenv/config");
  }
} catch {}

import { fetchAmazonOffers } from "../fetchers/amazon/paapi.js";
import { upsertOffers } from "../upsert/upsertOffers.js";

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

async function main() {
  const [siteId, ...asins] = process.argv.slice(2).filter(Boolean);
  if (!siteId || asins.length === 0) {
    console.error(
      "Usage: pnpm -C firebase/functions exec tsx src/scripts/updateByAsins.ts <siteId> <ASIN...>"
    );
    process.exit(1);
  }

  const result = await fetchAmazonOffers(asins);
  for (const asin of asins) {
    const hit = result[asin];
    if (!hit) {
      console.warn("no offer:", asin);
      continue;
    }

    // 価格がある時だけ upsertOffers（OfferInput は url が必須）
    if (isNumber(hit.price)) {
      const url = hit.url ?? `https://www.amazon.co.jp/dp/${asin}`;
      await upsertOffers(asin, { price: hit.price, url }, siteId);
      console.log("done:", siteId, asin, hit.price);
    } else {
      console.log("skip (no price):", asin);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
