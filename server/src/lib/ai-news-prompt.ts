import { CATEGORY_VALUES } from './ai-news';

export type LlmItem = {
  title: string;
  oneLineSummary: string;
  url: string;
  category: (typeof CATEGORY_VALUES)[number];
};

export type LlmOutput = {
  summary: string;
  items: LlmItem[];
};

export function buildPrompt(): string {
  return `You are a daily news curator for an AI-assisted-development dashboard.

Task: using web search, produce today's top 10 news items across these
categories: tool (Claude Code/Cursor/Copilot/Cody/Aider/Windsurf…),
model (Claude/GPT/Gemini/Llama releases + coding benchmarks), protocol
(MCP, agent frameworks, tool-use standards), research (papers on
AI-assisted coding, agent eval, RAG-for-code), community (notable
blog posts, build logs).

Rules:
- Only items from the last 48 hours. Skip older news even if relevant.
- Prioritize announcements with concrete changes (shipped features,
  released models, merged specs) over think-pieces.
- Diversify categories: don't return 10 tool items.
- Each item: headline (<80 chars), one-line summary (<140 chars),
  canonical source URL (prefer the vendor/paper/GitHub link, not news
  aggregators), and category from the set above.
- summary: one short paragraph (~3 sentences) naming the biggest
  2-3 stories of the day, written for a working developer.

Output ONLY a single JSON object matching this schema, no prose:

{
  "summary": "string",
  "items": [
    { "title": "string", "oneLineSummary": "string",
      "url": "string", "category": "tool|model|protocol|research|community" }
  ]
}
`;
}

export function isValidLlmOutput(x: unknown): x is LlmOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.summary !== 'string' || o.summary.length === 0) return false;
  if (!Array.isArray(o.items)) return false;
  if (o.items.length < 1 || o.items.length > 15) return false;
  for (const item of o.items) {
    if (!item || typeof item !== 'object') return false;
    const it = item as Record<string, unknown>;
    if (typeof it.title !== 'string') return false;
    if (typeof it.oneLineSummary !== 'string') return false;
    if (typeof it.url !== 'string' || !/^https?:\/\//i.test(it.url)) return false;
    if (typeof it.category !== 'string') return false;
    if (!(CATEGORY_VALUES as readonly string[]).includes(it.category)) return false;
  }
  return true;
}
