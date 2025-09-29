// firebase/scripts/syncSharedSchemas.cjs
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../packages/shared-schemas/dist");
const DEST = path.resolve(__dirname, "../functions/shared-schemas");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[syncSharedSchemas] source not found: ${src}`);
    process.exit(1);
  }
  // いったん消してから作り直す
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  // dist を丸ごとコピー
  const distDest = path.join(DEST, "dist");
  fs.mkdirSync(distDest, { recursive: true });
  for (const name of fs.readdirSync(SRC)) {
    fs.copyFileSync(path.join(SRC, name), path.join(distDest, name));
  }

  // npm から参照される package.json（file: 依存で拾わせる）
  const pkg = {
    name: "@affiscope/shared-schemas",
    version: "0.0.0-local",
    main: "dist/index.cjs",
    module: "dist/index.js",
    types: "dist/index.d.ts",
    type: "commonjs",
  };
  fs.writeFileSync(
    path.join(DEST, "package.json"),
    JSON.stringify(pkg, null, 2)
  );

  console.log("[syncSharedSchemas] copied:", SRC, "->", distDest);
}

copyDir(SRC, DEST);
