// firebase/functions/src/utils/blogPrompt.ts
export function buildPrompt(input: {
  siteName: string;
  siteId: string;
  product: {
    name: string;
    tags?: string[];
    features?: string[];
    asin?: string;
  };
  persona: string;
  pain: string;
}) {
  return `
あなたは${input.siteName}の編集者。読者の悩みを最短で解決する記事を作ります。
出力は必ずJSONのみ。

# 目的
- 検索者の「${input.pain}」に対して、体感ベネフィットで即答する
- 記事は会話調で読みやすく、結論→理由→具体策→商品→比較→FAQ→CTAの順

# 制約
- 事実に忠実。誇張なし。
- 文体: やさしく、断定しすぎない（〜かも）。
- 内部リンク想定の見出しキー（"slugKeys"）を含める。

# 入力
- メイン商品: ${input.product.name}
- 想定読者: ${input.persona}
- サイトID: ${input.siteId}

# 出力JSONスキーマ
{
  "title": string,
  "excerpt": string,
  "hero": { "imageKeyword": string },
  "toc": string[],
  "sections": [{ "h2": string, "bodyMd": string }],
  "product": { "name": string, "asin": string, "keyBenefits": string[] },
  "alternatives": [{ "name": string, "asin": string, "why": string }],
  "faq": [{ "q": string, "a": string }],
  "slugKeys": string[],
  "cta": { "label": string, "note": string }
}
`;
}
