// firebase/functions/src/scripts/updateByAsins.ts
import "dotenv/config";
import { fetchAmazonOffers } from "../fetchers/amazon/paapi";
import { upsertOffers } from "../upsert/upsertOffers";

async function main() {
  const [siteId, ...asins] = process.argv.slice(2).filter(Boolean);
  if (!siteId || asins.length === 0) {
    console.error(
      "Usage: ts-node src/scripts/updateByAsins.ts <siteId> <ASIN...>"
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
    await upsertOffers(asin, { price: hit.price, url: hit.url }, siteId);
    console.log("done:", siteId, asin, hit.price);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
