import path from "node:path";

export type DedupeSource = {
  asin?: string;
  jan?: string;
  ean?: string;
  modelNumber?: string;
  productName: string;
  imageUrl?: string;
};

const BAD = new Set(["USB", "TYPEC", "TYPE-C", "PD", "QC", "LED"]);

function modelFromName(name: string): string | undefined {
  const cand = name?.toUpperCase().match(/[A-Z0-9-]{4,}/g);
  if (!cand) return;
  return cand.find((c) => !BAD.has(c));
}

function imageKey(url?: string): string | undefined {
  if (!url) return;
  try {
    const u = new URL(url);
    return path.basename(u.pathname);
  } catch {
    const clean = url.split("?")[0];
    return clean.split("/").pop();
  }
}

export function buildDedupeKey(src: DedupeSource): {
  key: string;
  reason: string;
} {
  if (src.asin) return { key: `asin:${src.asin}`, reason: "asin" };
  if (src.jan) return { key: `jan:${src.jan}`, reason: "jan" };
  if (src.ean) return { key: `ean:${src.ean}`, reason: "ean" };
  if (src.modelNumber)
    return { key: `model:${src.modelNumber}`, reason: "modelNumber" };
  const m = modelFromName(src.productName);
  if (m) return { key: `model:${m}`, reason: "modelFromName" };
  const ik = imageKey(src.imageUrl);
  if (ik) return { key: `img:${ik}`, reason: "imageKey" };
  const norm = src.productName
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return { key: `title:${norm}`, reason: "title" };
}
