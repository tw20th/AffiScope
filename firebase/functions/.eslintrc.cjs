/** ESLint for Firebase Functions (pragmatic settings) */
module.exports = {
  root: true,

  // ビルド成果物と設定ファイルは対象外
  ignorePatterns: ["dist/**", "lib/**", "node_modules/**", "shared-*", "*.cjs"],

  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.eslint.json"], // Lint専用 tsconfig
    tsconfigRootDir: __dirname,
    sourceType: "module",
  },

  plugins: ["@typescript-eslint"],
  extends: ["plugin:@typescript-eslint/recommended"],

  rules: {
    // SDKレスポンスのパース等で any が必要になるため、ERROR→OFF
    "@typescript-eslint/no-explicit-any": "off",

    // 未使用は警告扱い。引数・変数が意図的に未使用なら _prefix で除外
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      },
    ],
  },

  overrides: [
    {
      files: ["src/scripts/**/*"],
      // スクリプトは更に緩める（中間ログや使い捨てコードが多い）
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
  ],
};
