import { CATEGORY_VALUES, type Category } from './braindump';

export type LlmOutput = {
  category: Category;
  title: string;
  summary: string;
  tags: string[];
};

export function isValidLlmOutput(x: unknown): x is LlmOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.category !== 'string' ||
    !(CATEGORY_VALUES as readonly string[]).includes(o.category)
  )
    return false;
  if (typeof o.title !== 'string') return false;
  if (typeof o.summary !== 'string') return false;
  if (!Array.isArray(o.tags)) return false;
  if (!o.tags.every((t) => typeof t === 'string')) return false;
  return true;
}

export const PROMPT = `You are classifying a personal braindump entry. Respond with ONLY valid JSON matching:
{"category": "todo" | "thought" | "read-later",
 "title": "5-8 word list label",
 "summary": "1-2 sentence summary",
 "tags": ["optional", "up-to-3", "short", "tags"]}

Rules:
- Pick \`todo\` if the text describes something the user intends to do.
- Pick \`read-later\` if the text is primarily a URL, an article reference, or says "read/watch/check out X".
- Pick \`thought\` otherwise (ideas, reflections, rants, notes to self).
- Tags are optional. Use lowercase; prefer \`key:value\` for structured (project, urgency) but plain single words are fine.
- Output JSON ONLY — no prose, no code fence.

Entry:
`;
