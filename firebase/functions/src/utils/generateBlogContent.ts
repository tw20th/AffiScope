import { getOpenAI } from "../lib/openai.js";
import { buildPrompt } from "./blogPrompt.js";

type GenerateParams = {
  product: { name: string; asin: string; tags?: string[] };
  siteId: string;
  siteName: string;
  persona: string;
  pain: string;
};

const MODEL = process.env.MODEL_BLOG || "gpt-4o-mini";

/** ```json ... ``` の JSON だけ抜く */
function extractJson(text: string): string {
  const m =
    text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  return m ? m[1] ?? "" : text;
}

function safeParse<T = any>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return {} as T;
  }
}

function toMarkdown(j: any) {
  const lines: string[] = [];
  if (j.title) lines.push(`# ${j.title}`);
  if (j.excerpt) lines.push("", String(j.excerpt));
  if (Array.isArray(j.toc) && j.toc.length) {
    lines.push("", "## 目次", ...j.toc.map((t: string) => `- ${t}`));
  }
  if (Array.isArray(j.sections)) {
    for (const s of j.sections) {
      if (!s) continue;
      if (s.h2) lines.push("", `## ${s.h2}`);
      if (s.bodyMd) lines.push(String(s.bodyMd));
    }
  }
  if (Array.isArray(j.faq) && j.faq.length) {
    lines.push("", "## よくある質問");
    for (const f of j.faq) {
      if (!f) continue;
      if (f.q) lines.push(`**Q. ${f.q}**`);
      if (f.a) lines.push(String(f.a));
      lines.push("");
    }
  }
  if (j.cta?.label || j.cta?.note) {
    lines.push("", `> CTA: ${j.cta?.label ?? "詳細を見る"}`, j.cta?.note ?? "");
  }
  return lines.join("\n");
}

export async function generateBlogContent(params: GenerateParams) {
  const openai = getOpenAI(); // ← 実行時に初めて初期化

  const prompt = buildPrompt(params);

  // responses API
  const res = await openai.responses.create({
    model: MODEL,
    input: prompt,
    temperature: 0.4,
    max_output_tokens: 2000,
  });

  const raw = (res as any).output_text ?? "";
  const json = safeParse(extractJson(raw));

  const title = json.title || `${params.product.name} 値下げ情報`;
  const excerpt = json.excerpt ?? null;
  const tags = Array.isArray(json.slugKeys)
    ? json.slugKeys
    : params.product.tags ?? [];

  return {
    title,
    excerpt,
    tags,
    content: toMarkdown(json),
    imageUrl: undefined as string | undefined,
  };
}
