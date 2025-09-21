import "dotenv/config";
import * as admin from "firebase-admin";
import { updatePricesOnce } from "../jobs/updatePrices";

// Firestore 初期化 & undefined スキップ
if (admin.apps.length === 0) admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

updatePricesOnce()
  .then(() => {
    console.log("updatePricesOnce: done");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
