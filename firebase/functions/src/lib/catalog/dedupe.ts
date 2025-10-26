import { createHash } from "node:crypto";

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[【】\[\]()（）]/g, " ")
    .replace(/[^\p{Letter}\p{Number}\s%+.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeDedupeKey(title: string): string {
  const norm = normalizeTitle(title);
  return createHash("sha1").update(norm).digest("hex");
}
