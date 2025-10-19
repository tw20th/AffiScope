// firebase/functions/src/scripts/ops/queueHousekeeping.ts
import { runQueueHousekeeping } from "../../jobs/queueHousekeeping.js";
(async () => {
  await runQueueHousekeeping();
  console.log("[ops/queueHousekeeping] done");
})();
