// firebase/functions/src/scripts/ops/queueHousekeeping.ts
import { runQueueHousekeepingOnce } from "../../jobs/ops/queueHousekeeping.js";

(async () => {
  const result = await runQueueHousekeepingOnce();
  console.log("[ops/queueHousekeeping] done:", result);
})();
