// firebase/functions/src/scripts/_firestoreClient.ts
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function getDb() {
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    });
  }
  const db = getFirestore();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(
      `[seed] Using EMULATOR: ${process.env.FIRESTORE_EMULATOR_HOST}`
    );
  } else {
    console.log(
      `[seed] Using PROD: ${
        process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
      }`
    );
  }
  return db;
}
