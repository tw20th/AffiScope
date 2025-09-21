// apps/web/lib/converters.ts
import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Product } from "@affiscope/shared-types";

export const productConverter: FirestoreDataConverter<Product> = {
  toFirestore(p: Product) {
    const { asin, ...rest } = p;
    return { ...rest };
  },
  fromFirestore(snap: QueryDocumentSnapshot): Product {
    const data = snap.data() as Omit<Product, "asin">;
    return { asin: snap.id, ...data };
  },
};
