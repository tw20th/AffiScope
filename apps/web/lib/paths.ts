// apps/web/lib/paths.ts
import { existsSync } from "fs";
import { resolve } from "path";

/**
 * Monorepo内の firebase/functions/sites を堅牢に解決する。
 * - apps/web からのビルド/実行でも壊れない
 * - CIや各種実行ディレクトリの差異にも耐える
 */
export function resolveSitesDir(): string {
  const candidates = [
    // apps/web -> repo/firebase/functions/sites
    resolve(process.cwd(), "../../firebase/functions/sites"),
    // 念のための候補
    resolve(process.cwd(), "../firebase/functions/sites"),
    resolve(process.cwd(), "firebase/functions/sites"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `sites directory not found. Tried:\n${candidates.join("\n")}`
    );
  }
  return found;
}
