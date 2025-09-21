// firebase/functions/src/index.ts
import * as functions from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();
getFirestore().settings({ ignoreUndefinedProperties: true });

export const health = functions
  .region("asia-northeast1")
  .https.onRequest((_req, res) => {
    res.status(200).send("ok");
  });

export { trackClick } from "./http/trackClick";
export { scheduledUpdatePrices, runUpdatePrices } from "./jobs/updatePrices";
