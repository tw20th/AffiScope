// firebase/scripts/syncSharedTypes.cjs
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  const root = path.resolve(__dirname, ".."); // firebase/
  const monorepoRoot = path.resolve(root, ".."); // repo root
  const srcDist = path.resolve(monorepoRoot, "packages/shared-types/dist");
  const dstRoot = path.resolve(root, "functions/shared-types");
  const dstDist = path.join(dstRoot, "dist");

  if (!fs.existsSync(srcDist)) {
    console.error(
      "[syncSharedTypes] dist not found:",
      srcDist,
      "\nRun: pnpm -C ../packages/shared-types build"
    );
    process.exit(2);
  }

  // clean & copy
  fs.rmSync(dstRoot, { recursive: true, force: true });
  fs.mkdirSync(dstDist, { recursive: true });
  copyDir(srcDist, dstDist);

  // ← ここがポイント：CJS 出力に合わせて type を commonjs に
  const pkg = {
    name: "@affiscope/shared-types",
    version: "0.0.1",
    type: "commonjs",
    main: "dist/index.js",
    types: "dist/index.d.ts",
  };
  fs.writeFileSync(
    path.join(dstRoot, "package.json"),
    JSON.stringify(pkg, null, 2)
  );

  console.log("[syncSharedTypes] copied:", srcDist, "->", dstRoot);
  // 正常終了
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error("[syncSharedTypes] FAILED:", e);
  process.exit(1);
}
