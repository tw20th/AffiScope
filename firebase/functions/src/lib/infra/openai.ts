import OpenAI from "openai";

/** 遅延初期化（デプロイ時 Missing credentials 回避） */
let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (runtime).");
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}
