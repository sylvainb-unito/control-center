# AI News Digest Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AI News Digest panel — a daily LLM-driven digest of AI-assisted-dev news with a starred-items tab.

**Architecture:** Mirrors the braindump panel. Reuses `defaultRunClaude` (spawns `claude -p`, which has WebSearch built in) and the hourly-tick pattern with an added daily-run gate. Per-digest JSON files on disk under `~/.claude/ai-news/digests/`, starred flag on items, automatic prune of unstarred files older than 7 days.

**Tech Stack:** TypeScript strict · Hono · React 18 · TanStack Query v5 · Vitest · Biome · plain CSS modules · react-markdown + remark-gfm (already in the project for journals).

**Reference:** `docs/superpowers/specs/2026-04-21-ai-news-design.md`.

---

## File structure

**Created:**
- `panels/ai-news/package.json` — workspace package matching `panels/braindump/package.json`.
- `panels/ai-news/tsconfig.json` — extends `tsconfig.base.json` matching braindump's.
- `panels/ai-news/meta.ts` — `{ id: 'ai-news', title: 'AI News', order: 70, defaultSize: 'md' }`.
- `panels/ai-news/types.ts` — shared types + frontend-only constants (mirrors braindump).
- `panels/ai-news/api.ts` — Hono routes (`/today`, `/starred`, `/digests/:date/items/:id/star`, `/run`).
- `panels/ai-news/api.test.ts` — envelope + error-code coverage.
- `panels/ai-news/ui.tsx` — two-tab panel (Digest / Starred).
- `panels/ai-news/ui.module.css` — retrowave styling.
- `server/src/lib/ai-news.ts` — CRUD: list/read digests, toggle star, prune, read/write state.
- `server/src/lib/ai-news.test.ts` — filesystem-level coverage with injected deps.
- `server/src/lib/ai-news-prompt.ts` — `buildPrompt()` + `isValidLlmOutput()` type guard.
- `server/src/lib/ai-news-prompt.test.ts` — prompt shape + parser coverage.
- `server/src/lib/ai-news-processor.ts` — tick + `runDigest` + single-flight.
- `server/src/lib/ai-news-processor.test.ts` — gate logic + success/failure paths.

**Modified:**
- `web/src/panels.ts` — register `ai-news` panel.
- `server/src/routes.ts` — register `/api/ai-news` routes.
- `server/src/main.ts` — start the ai-news processor on boot + hourly tick.

---

## Task 1: Scaffold `panels/ai-news/` workspace

**Files:**
- Create: `panels/ai-news/package.json`
- Create: `panels/ai-news/tsconfig.json`
- Create: `panels/ai-news/meta.ts`
- Create: `panels/ai-news/types.ts`
- Modify: `web/src/panels.ts`
- Modify: `server/src/routes.ts`

- [ ] **Step 1: Create `panels/ai-news/package.json`**

```json
{
  "name": "@cc/panel-ai-news",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./ui": "./ui.tsx",
    "./api": "./api.ts",
    "./meta": "./meta.ts",
    "./types": "./types.ts"
  },
  "scripts": { "test": "vitest run --passWithNoTests" },
  "dependencies": {
    "@cc/server": "workspace:*",
    "@cc/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.2",
    "hono": "^4.6.14",
    "react": "^18.3.1",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

(Exact versions: match `panels/journals/package.json` for `react-markdown`/`remark-gfm` — use `pnpm why react-markdown` if the numbers above don't resolve.)

- [ ] **Step 2: Create `panels/ai-news/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `panels/ai-news/meta.ts`**

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'ai-news',
  title: 'AI News',
  order: 70,
  defaultSize: 'md',
};
```

- [ ] **Step 4: Create `panels/ai-news/types.ts`** (placeholder — grown in Task 2)

```ts
export type AiNewsCategory = 'tool' | 'model' | 'protocol' | 'research' | 'community';

export const CATEGORY_VALUES = ['tool', 'model', 'protocol', 'research', 'community'] as const;

export type AiNewsItem = {
  id: string;
  title: string;
  oneLineSummary: string;
  url: string;
  category: AiNewsCategory;
  starred: boolean;
};

export type AiNewsDigest = {
  date: string;
  runAt: string;
  summary: string;
  items: AiNewsItem[];
};

export type AiNewsState = {
  isRunning: boolean;
  lastRunAt?: string;
  lastError?: string;
};

export type TodayResponse = { digest: AiNewsDigest | null; state: AiNewsState };
export type StarredResponse = { items: (AiNewsItem & { digestDate: string })[] };
export type StarResponse = { starred: boolean };
export type RunResponse = { triggered: true };
```

- [ ] **Step 5: Stub `panels/ai-news/api.ts` and `panels/ai-news/ui.tsx`**

Minimal stubs so the registries type-check. `api.ts`:

```ts
import { ok } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/today', (c) => c.json(ok({ digest: null, state: { isRunning: false } })));
```

`ui.tsx`:

```tsx
import s from './ui.module.css';

export const UI = () => <div className={s.root}>AI News (stub)</div>;
```

`ui.module.css`:

```css
.root { padding: 12px; color: var(--text-primary); }
```

- [ ] **Step 6: Register panel UI in `web/src/panels.ts`**

Add alphabetically next to other imports:

```ts
import { meta as aiNewsMeta } from '../../panels/ai-news/meta';
import { UI as aiNewsUI } from '../../panels/ai-news/ui';
```

Append to the `panels` array:

```ts
  { meta: aiNewsMeta, UI: aiNewsUI },
```

- [ ] **Step 7: Register panel API in `server/src/routes.ts`**

Import:

```ts
import { api as aiNewsApi } from '../../panels/ai-news/api';
```

Register inside `registerRoutes`:

```ts
  app.route('/api/ai-news', aiNewsApi);
```

- [ ] **Step 8: Install + verify**

Run: `pnpm install`
Expected: resolves new workspace package, adds `react-markdown` / `remark-gfm` to the ai-news panel if they weren't already root-hoisted.

Run: `pnpm -r test`
Expected: PASS (ai-news test script uses `--passWithNoTests`).

Run: `pnpm --filter @cc/web build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add panels/ai-news web/src/panels.ts server/src/routes.ts pnpm-lock.yaml
git commit -m "feat(panels/ai-news): scaffold workspace and wire into registries"
```

---

## Task 2: Server lib `ai-news.ts` — filesystem CRUD (TDD)

**Files:**
- Create: `server/src/lib/ai-news.ts`
- Test: `server/src/lib/ai-news.test.ts`

Exports the pure + injected-deps CRUD used by the API and processor.

- [ ] **Step 1: Write the failing test file `server/src/lib/ai-news.test.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  DigestNotFoundError,
  DigestReadError,
  ItemNotFoundError,
  listDigests,
  pruneOldDigests,
  readDigest,
  readState,
  toggleStar,
  writeDigest,
  writeState,
} from './ai-news';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ai-news-'));
}

describe('ai-news CRUD', () => {
  let home: string;
  beforeEach(() => {
    home = tmpHome();
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('listDigests returns [] when dir is missing (ENOENT)', async () => {
    const dates = await listDigests({ home });
    expect(dates).toEqual([]);
  });

  test('listDigests returns dates sorted desc, skips non-matching names', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['2026-04-19.json', '2026-04-21.json', '2026-04-20.json', 'garbage.txt']) {
      fs.writeFileSync(path.join(dir, f), '{}');
    }
    const dates = await listDigests({ home });
    expect(dates).toEqual(['2026-04-21', '2026-04-20', '2026-04-19']);
  });

  test('readDigest returns parsed digest', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      date: '2026-04-21',
      runAt: '2026-04-21T07:00:00Z',
      summary: 'summary',
      items: [
        {
          id: 'abc',
          title: 't',
          oneLineSummary: 's',
          url: 'https://x',
          category: 'tool',
          starred: false,
        },
      ],
    };
    fs.writeFileSync(path.join(dir, '2026-04-21.json'), JSON.stringify(payload));
    const got = await readDigest('2026-04-21', { home });
    expect(got.date).toBe('2026-04-21');
    expect(got.items).toHaveLength(1);
  });

  test('readDigest throws DigestNotFoundError on ENOENT', async () => {
    await expect(readDigest('2026-04-21', { home })).rejects.toBeInstanceOf(DigestNotFoundError);
  });

  test('readDigest throws DigestReadError on malformed JSON', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-04-21.json'), '{not-json');
    await expect(readDigest('2026-04-21', { home })).rejects.toBeInstanceOf(DigestReadError);
  });

  test('writeDigest is atomic (tmp + rename)', async () => {
    const digest = {
      date: '2026-04-21',
      runAt: '2026-04-21T07:00:00Z',
      summary: '',
      items: [],
    };
    await writeDigest(digest, { home });
    const file = path.join(home, '.claude', 'ai-news', 'digests', '2026-04-21.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.date).toBe('2026-04-21');
  });

  test('toggleStar updates the flag and returns new value', async () => {
    const digest = {
      date: '2026-04-21',
      runAt: 'x',
      summary: '',
      items: [
        {
          id: 'abc',
          title: 't',
          oneLineSummary: 's',
          url: 'https://x',
          category: 'tool' as const,
          starred: false,
        },
      ],
    };
    await writeDigest(digest, { home });
    const r1 = await toggleStar('2026-04-21', 'abc', true, { home });
    expect(r1.starred).toBe(true);
    const got = await readDigest('2026-04-21', { home });
    expect(got.items[0]!.starred).toBe(true);
  });

  test('toggleStar throws DigestNotFoundError for unknown date', async () => {
    await expect(toggleStar('2026-04-21', 'abc', true, { home })).rejects.toBeInstanceOf(
      DigestNotFoundError,
    );
  });

  test('toggleStar throws ItemNotFoundError for unknown id', async () => {
    const digest = { date: '2026-04-21', runAt: 'x', summary: '', items: [] };
    await writeDigest(digest, { home });
    await expect(toggleStar('2026-04-21', 'missing', true, { home })).rejects.toBeInstanceOf(
      ItemNotFoundError,
    );
  });

  test('pruneOldDigests keeps recent, keeps starred, deletes old unstarred', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    const mk = (date: string, starred: boolean) =>
      fs.writeFileSync(
        path.join(dir, `${date}.json`),
        JSON.stringify({
          date,
          runAt: 'x',
          summary: '',
          items: [
            {
              id: 'a',
              title: 't',
              oneLineSummary: 's',
              url: 'https://x',
              category: 'tool',
              starred,
            },
          ],
        }),
      );
    mk('2026-04-01', false); // old, no stars -> delete
    mk('2026-04-02', true); // old but starred -> keep
    mk('2026-04-20', false); // recent -> keep
    const today = new Date('2026-04-21T12:00:00Z');
    await pruneOldDigests(today, 7, { home });
    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toEqual(['2026-04-02.json', '2026-04-20.json']);
  });

  test('readState returns default when missing', async () => {
    const s = await readState({ home });
    expect(s).toEqual({ isRunning: false });
  });

  test('writeState round-trips', async () => {
    await writeState({ isRunning: true, lastRunAt: 'x' }, { home });
    expect(await readState({ home })).toEqual({ isRunning: true, lastRunAt: 'x' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cc/server test ai-news.test`
Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Implement `server/src/lib/ai-news.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AiNewsCategory = 'tool' | 'model' | 'protocol' | 'research' | 'community';

export const CATEGORY_VALUES: readonly AiNewsCategory[] = [
  'tool',
  'model',
  'protocol',
  'research',
  'community',
];

export type AiNewsItem = {
  id: string;
  title: string;
  oneLineSummary: string;
  url: string;
  category: AiNewsCategory;
  starred: boolean;
};

export type AiNewsDigest = {
  date: string;
  runAt: string;
  summary: string;
  items: AiNewsItem[];
};

export type AiNewsState = {
  isRunning: boolean;
  lastRunAt?: string;
  lastError?: string;
};

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const ITEM_ID_REGEX = /^[A-Za-z0-9-]+$/;

export class DigestNotFoundError extends Error {
  readonly code = 'DIGEST_NOT_FOUND';
  constructor(date: string) {
    super(`digest not found: ${date}`);
  }
}
export class DigestReadError extends Error {
  readonly code = 'READ_FAILED';
}
export class ItemNotFoundError extends Error {
  readonly code = 'ITEM_NOT_FOUND';
  constructor(id: string) {
    super(`item not found: ${id}`);
  }
}

export type DirDeps = { home?: string };

function rootDir(home: string): string {
  return path.join(home, '.claude', 'ai-news');
}
function digestsDir(home: string): string {
  return path.join(rootDir(home), 'digests');
}
function digestPath(home: string, date: string): string {
  return path.join(digestsDir(home), `${date}.json`);
}
function statePath(home: string): string {
  return path.join(rootDir(home), 'state.json');
}

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

export async function listDigests(deps: DirDeps = {}): Promise<string[]> {
  const home = deps.home ?? os.homedir();
  const dir = digestsDir(home);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((n) => n.endsWith('.json') && DATE_REGEX.test(n.slice(0, -5)))
    .map((n) => n.slice(0, -5))
    .sort((a, b) => (a < b ? 1 : -1));
}

export async function readDigest(date: string, deps: DirDeps = {}): Promise<AiNewsDigest> {
  const home = deps.home ?? os.homedir();
  let raw: string;
  try {
    raw = await fs.promises.readFile(digestPath(home, date), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new DigestNotFoundError(date);
    throw new DigestReadError((err as Error).message);
  }
  try {
    const parsed = JSON.parse(raw) as AiNewsDigest;
    return parsed;
  } catch (err) {
    throw new DigestReadError(`invalid digest JSON: ${(err as Error).message}`);
  }
}

export async function writeDigest(digest: AiNewsDigest, deps: DirDeps = {}): Promise<void> {
  const home = deps.home ?? os.homedir();
  await ensureDir(digestsDir(home));
  const final = digestPath(home, digest.date);
  const tmp = `${final}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(digest, null, 2), 'utf8');
  await fs.promises.rename(tmp, final);
}

export async function toggleStar(
  date: string,
  id: string,
  starred: boolean,
  deps: DirDeps = {},
): Promise<{ starred: boolean }> {
  const digest = await readDigest(date, deps);
  const item = digest.items.find((i) => i.id === id);
  if (!item) throw new ItemNotFoundError(id);
  item.starred = starred;
  await writeDigest(digest, deps);
  return { starred };
}

export async function pruneOldDigests(
  now: Date,
  retainDays: number,
  deps: DirDeps = {},
): Promise<void> {
  const home = deps.home ?? os.homedir();
  const cutoffMs = now.getTime() - retainDays * 24 * 60 * 60 * 1000;
  const dates = await listDigests(deps);
  for (const date of dates) {
    const ms = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(ms) || ms >= cutoffMs) continue;
    try {
      const digest = await readDigest(date, deps);
      if (digest.items.some((i) => i.starred)) continue;
      await fs.promises.unlink(digestPath(home, date));
    } catch {
      // swallow: broken files stay, will be revisited next tick
    }
  }
}

export async function readState(deps: DirDeps = {}): Promise<AiNewsState> {
  const home = deps.home ?? os.homedir();
  try {
    const raw = await fs.promises.readFile(statePath(home), 'utf8');
    const parsed = JSON.parse(raw) as AiNewsState;
    return { isRunning: Boolean(parsed.isRunning), ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { isRunning: false };
    throw err;
  }
}

export async function writeState(state: AiNewsState, deps: DirDeps = {}): Promise<void> {
  const home = deps.home ?? os.homedir();
  await ensureDir(rootDir(home));
  await fs.promises.writeFile(statePath(home), JSON.stringify(state, null, 2), 'utf8');
}

export async function listStarred(
  deps: DirDeps = {},
): Promise<((AiNewsItem & { digestDate: string })[])> {
  const dates = await listDigests(deps);
  const out: (AiNewsItem & { digestDate: string })[] = [];
  for (const date of dates) {
    try {
      const digest = await readDigest(date, deps);
      for (const item of digest.items) {
        if (item.starred) out.push({ ...item, digestDate: date });
      }
    } catch {
      // skip malformed files
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test ai-news.test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ai-news.ts server/src/lib/ai-news.test.ts
git commit -m "feat(server): ai-news CRUD lib with injected-deps test coverage"
```

---

## Task 3: Server lib `ai-news-prompt.ts` — prompt + output type guard (TDD)

**Files:**
- Create: `server/src/lib/ai-news-prompt.ts`
- Test: `server/src/lib/ai-news-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { buildPrompt, isValidLlmOutput } from './ai-news-prompt';

describe('buildPrompt', () => {
  test('is non-empty and mentions each category', () => {
    const p = buildPrompt();
    expect(p.length).toBeGreaterThan(100);
    for (const cat of ['tool', 'model', 'protocol', 'research', 'community']) {
      expect(p).toContain(cat);
    }
    expect(p).toMatch(/JSON/);
  });
});

describe('isValidLlmOutput', () => {
  const sample = {
    summary: 'today in AI…',
    items: Array.from({ length: 10 }, (_, i) => ({
      title: `t${i}`,
      oneLineSummary: 's',
      url: `https://x/${i}`,
      category: 'tool',
    })),
  };

  test('accepts well-formed object', () => {
    expect(isValidLlmOutput(sample)).toBe(true);
  });

  test('rejects missing summary', () => {
    expect(isValidLlmOutput({ ...sample, summary: undefined })).toBe(false);
  });

  test('rejects empty items array', () => {
    expect(isValidLlmOutput({ ...sample, items: [] })).toBe(false);
  });

  test('rejects >15 items', () => {
    const big = { ...sample, items: Array.from({ length: 16 }, () => sample.items[0]) };
    expect(isValidLlmOutput(big)).toBe(false);
  });

  test('rejects item with unknown category', () => {
    const bad = { ...sample, items: [{ ...sample.items[0], category: 'other' }] };
    expect(isValidLlmOutput(bad)).toBe(false);
  });

  test('rejects item with non-string url', () => {
    const bad = { ...sample, items: [{ ...sample.items[0], url: 42 }] };
    expect(isValidLlmOutput(bad)).toBe(false);
  });

  test('rejects non-object input', () => {
    expect(isValidLlmOutput(null)).toBe(false);
    expect(isValidLlmOutput('hello')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cc/server test ai-news-prompt.test`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/lib/ai-news-prompt.ts`**

```ts
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
  if (!Array.isArray(o.items) || o.items.length < 1 || o.items.length > 15) return false;
  for (const raw of o.items) {
    if (!raw || typeof raw !== 'object') return false;
    const i = raw as Record<string, unknown>;
    if (typeof i.title !== 'string') return false;
    if (typeof i.oneLineSummary !== 'string') return false;
    if (typeof i.url !== 'string') return false;
    if (
      typeof i.category !== 'string' ||
      !(CATEGORY_VALUES as readonly string[]).includes(i.category)
    )
      return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test ai-news-prompt.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ai-news-prompt.ts server/src/lib/ai-news-prompt.test.ts
git commit -m "feat(server): ai-news-prompt with LLM output type guard"
```

---

## Task 4: Server lib `ai-news-processor.ts` — daily-run gate + tick (TDD)

**Files:**
- Create: `server/src/lib/ai-news-processor.ts`
- Test: `server/src/lib/ai-news-processor.test.ts`

The processor needs pure logic testable with injected deps: `runClaude`, `now`, `home`, and `randomId`.

- [ ] **Step 1: Write the failing test file**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { listDigests, readDigest, readState } from './ai-news';
import { _resetForTests, runDigest, tick } from './ai-news-processor';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ai-news-proc-'));
}

function validRaw(): string {
  return JSON.stringify({
    summary: 's',
    items: Array.from({ length: 10 }, (_, i) => ({
      title: `t${i}`,
      oneLineSummary: 'x',
      url: `https://x/${i}`,
      category: 'tool',
    })),
  });
}

describe('ai-news processor tick', () => {
  let home: string;
  let ids: number;
  beforeEach(() => {
    home = tmpHome();
    ids = 0;
    _resetForTests();
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  test('skips when before 7am', async () => {
    const runClaude = vi.fn();
    await tick({
      home,
      runClaude,
      now: () => new Date('2026-04-21T06:30:00-04:00'),
      randomId: () => `id${ids++}`,
    });
    expect(runClaude).not.toHaveBeenCalled();
  });

  test("skips when today's digest already exists", async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-21.json'),
      JSON.stringify({ date: '2026-04-21', runAt: 'x', summary: '', items: [] }),
    );
    const runClaude = vi.fn();
    await tick({
      home,
      runClaude,
      now: () => new Date('2026-04-21T09:00:00-04:00'),
      randomId: () => `id${ids++}`,
    });
    expect(runClaude).not.toHaveBeenCalled();
  });

  test('skips when state.isRunning is true', async () => {
    const dir = path.join(home, '.claude', 'ai-news');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ isRunning: true }));
    const runClaude = vi.fn();
    await tick({
      home,
      runClaude,
      now: () => new Date('2026-04-21T09:00:00-04:00'),
      randomId: () => `id${ids++}`,
    });
    expect(runClaude).not.toHaveBeenCalled();
  });

  test('happy path writes digest, clears lastError, sets lastRunAt', async () => {
    const runClaude = vi.fn(async () => validRaw());
    await tick({
      home,
      runClaude,
      now: () => new Date('2026-04-21T09:00:00-04:00'),
      randomId: () => `id${ids++}`,
    });
    expect(runClaude).toHaveBeenCalledOnce();
    const dates = await listDigests({ home });
    expect(dates).toContain('2026-04-21');
    const digest = await readDigest('2026-04-21', { home });
    expect(digest.items).toHaveLength(10);
    expect(digest.items.every((i) => i.id.startsWith('id'))).toBe(true);
    expect(digest.items.every((i) => i.starred === false)).toBe(true);
    const state = await readState({ home });
    expect(state.isRunning).toBe(false);
    expect(state.lastError).toBeUndefined();
    expect(state.lastRunAt).toBeDefined();
  });

  test('failure path preserves previous digest, records lastError', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-20.json'),
      JSON.stringify({ date: '2026-04-20', runAt: 'x', summary: '', items: [] }),
    );
    const runClaude = vi.fn(async () => 'not json');
    await tick({
      home,
      runClaude,
      now: () => new Date('2026-04-21T09:00:00-04:00'),
      randomId: () => `id${ids++}`,
    });
    const dates = await listDigests({ home });
    expect(dates).toContain('2026-04-20');
    expect(dates).not.toContain('2026-04-21');
    const state = await readState({ home });
    expect(state.isRunning).toBe(false);
    expect(state.lastError).toMatch(/invalid|json|schema/i);
  });

  test('runDigest with force overwrites existing file', async () => {
    const runClaude = vi.fn(async () => validRaw());
    await runDigest({
      home,
      runClaude,
      now: () => new Date('2026-04-21T09:00:00-04:00'),
      randomId: () => `id${ids++}`,
      force: true,
    });
    expect(runClaude).toHaveBeenCalledOnce();
    // Run again with force=true, ensure no throw
    await runDigest({
      home,
      runClaude,
      now: () => new Date('2026-04-21T10:00:00-04:00'),
      randomId: () => `id${ids++}`,
      force: true,
    });
    expect(runClaude).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @cc/server test ai-news-processor.test`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/lib/ai-news-processor.ts`**

```ts
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import {
  type AiNewsCategory,
  type AiNewsDigest,
  type AiNewsItem,
  type DirDeps,
  listDigests,
  pruneOldDigests,
  readDigest,
  readState,
  writeDigest,
  writeState,
} from './ai-news';
import { buildPrompt, isValidLlmOutput } from './ai-news-prompt';
import { extractJson } from './braindump-processor';
import { logger } from '../logger';

export type RunClaude = (args: {
  prompt: string;
  input: string;
  timeoutMs: number;
}) => Promise<string>;

export type TickDeps = DirDeps & {
  runClaude?: RunClaude;
  now?: () => Date;
  randomId?: () => string;
  timeoutMs?: number;
};

export type RunDigestDeps = TickDeps & { force?: boolean };

const DEFAULT_TIMEOUT_MS = 180_000;
const RETAIN_DAYS = 7;

let isTickInFlight = false;

export function _resetForTests(): void {
  isTickInFlight = false;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function defaultRandomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export async function tick(deps: TickDeps = {}): Promise<void> {
  if (isTickInFlight) return;
  isTickInFlight = true;
  try {
    const state = await readState(deps);
    if (state.isRunning) {
      logger.debug('ai-news tick skipped: state.isRunning');
      return;
    }
    const now = (deps.now ?? (() => new Date()))();
    const hour = now.getHours();
    if (hour < 7) {
      logger.debug({ hour }, 'ai-news tick skipped: before 7am');
      return;
    }
    const today = formatLocalDate(now);
    const existing = await listDigests(deps);
    if (existing.includes(today)) {
      logger.debug({ today }, 'ai-news tick skipped: digest already exists');
      return;
    }
    await runDigest({ ...deps, force: false });
  } finally {
    isTickInFlight = false;
  }
}

export async function runDigest(deps: RunDigestDeps = {}): Promise<void> {
  const runClaude = deps.runClaude ?? defaultRunClaude;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? defaultRandomId;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const targetDate = formatLocalDate(now());

  const prevState = await readState(deps);
  await writeState(
    { isRunning: true, lastRunAt: prevState.lastRunAt, lastError: prevState.lastError },
    deps,
  );

  try {
    const raw = await runClaude({ prompt: buildPrompt(), input: '', timeoutMs });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      throw new Error(`claude output was not JSON: ${(err as Error).message}`);
    }
    if (!isValidLlmOutput(parsed)) {
      throw new Error('claude output did not match expected schema');
    }

    const digest: AiNewsDigest = {
      date: targetDate,
      runAt: now().toISOString(),
      summary: parsed.summary,
      items: parsed.items.map(
        (it): AiNewsItem => ({
          id: randomId(),
          title: it.title,
          oneLineSummary: it.oneLineSummary,
          url: it.url,
          category: it.category as AiNewsCategory,
          starred: false,
        }),
      ),
    };

    await writeDigest(digest, deps);
    await writeState({ isRunning: false, lastRunAt: digest.runAt }, deps);
    await pruneOldDigests(now(), RETAIN_DAYS, deps);
    logger.info({ date: targetDate, items: digest.items.length }, 'ai-news digest written');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, 'ai-news digest run failed');
    await writeState(
      { isRunning: false, lastRunAt: prevState.lastRunAt, lastError: msg },
      deps,
    );
  }
}

// ---- default runClaude (spawns `claude -p`, same as braindump) ----

export const defaultRunClaude: RunClaude = async ({ prompt, input, timeoutMs }) => {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `claude -p exited with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
          ),
        );
    });

    child.stdin.on('error', () => {
      /* swallow EPIPE if child exits early */
    });
    child.stdin.write(`${prompt}\n\n${input}`.trim());
    child.stdin.end();
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test ai-news-processor.test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/ai-news-processor.ts server/src/lib/ai-news-processor.test.ts
git commit -m "feat(server): ai-news processor with daily-run gate and single-flight"
```

---

## Task 5: HTTP API routes (TDD)

**Files:**
- Modify: `panels/ai-news/api.ts` (replace stub)
- Create: `panels/ai-news/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { api } from './api';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ai-news-api-'));
}

describe('ai-news api', () => {
  let home: string;
  let prevHome: string | undefined;
  beforeEach(() => {
    home = tmpHome();
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const call = (url: string, init?: RequestInit) =>
    api.request(new Request(`http://localhost${url}`, init));

  test('GET /today returns null digest + default state when nothing exists', async () => {
    const res = await call('/today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { digest: null; state: { isRunning: boolean } } };
    expect(body.ok).toBe(true);
    expect(body.data.digest).toBeNull();
    expect(body.data.state.isRunning).toBe(false);
  });

  test('GET /today returns populated digest when file exists', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date();
    const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(
      path.join(dir, `${d}.json`),
      JSON.stringify({
        date: d,
        runAt: 'x',
        summary: 's',
        items: [
          {
            id: 'abc',
            title: 't',
            oneLineSummary: 's',
            url: 'https://x',
            category: 'tool',
            starred: false,
          },
        ],
      }),
    );
    const res = await call('/today');
    const body = (await res.json()) as { ok: boolean; data: { digest: { items: unknown[] } } };
    expect(body.data.digest?.items).toHaveLength(1);
  });

  test('POST /digests/:date/items/:id/star validates date', async () => {
    const res = await call('/digests/bad/items/abc/star', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starred: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('POST /digests/:date/items/:id/star 404 when digest missing', async () => {
    const res = await call('/digests/2026-04-21/items/abc/star', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starred: true }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DIGEST_NOT_FOUND');
  });

  test('POST /digests/:date/items/:id/star happy path', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-21.json'),
      JSON.stringify({
        date: '2026-04-21',
        runAt: 'x',
        summary: '',
        items: [
          {
            id: 'abc',
            title: 't',
            oneLineSummary: 's',
            url: 'https://x',
            category: 'tool',
            starred: false,
          },
        ],
      }),
    );
    const res = await call('/digests/2026-04-21/items/abc/star', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starred: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { starred: boolean } };
    expect(body.data.starred).toBe(true);
  });

  test('POST /run returns 409 when state.isRunning', async () => {
    const dir = path.join(home, '.claude', 'ai-news');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ isRunning: true }));
    const res = await call('/run', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RUN_IN_PROGRESS');
  });

  test('GET /starred returns only starred items with digestDate', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-20.json'),
      JSON.stringify({
        date: '2026-04-20',
        runAt: 'x',
        summary: '',
        items: [
          {
            id: 'a',
            title: 't1',
            oneLineSummary: 's',
            url: 'https://x',
            category: 'tool',
            starred: true,
          },
          {
            id: 'b',
            title: 't2',
            oneLineSummary: 's',
            url: 'https://y',
            category: 'tool',
            starred: false,
          },
        ],
      }),
    );
    const res = await call('/starred');
    const body = (await res.json()) as {
      data: { items: { id: string; digestDate: string }[] };
    };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.digestDate).toBe('2026-04-20');
    expect(body.data.items[0]!.id).toBe('a');
  });
});
```

- [ ] **Step 2: Replace `panels/ai-news/api.ts` with the real implementation**

```ts
import { fail, ok } from '@cc/server/envelope';
import {
  DATE_REGEX,
  DigestNotFoundError,
  DigestReadError,
  ITEM_ID_REGEX,
  ItemNotFoundError,
  listStarred,
  readDigest,
  readState,
  toggleStar,
} from '@cc/server/lib/ai-news';
import { runDigest } from '@cc/server/lib/ai-news-processor';
import { Hono } from 'hono';

export const api = new Hono();

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

api.get('/today', async (c) => {
  const state = await readState();
  try {
    const digest = await readDigest(todayLocal());
    return c.json(ok({ digest, state }));
  } catch (err) {
    if (err instanceof DigestNotFoundError) return c.json(ok({ digest: null, state }));
    if (err instanceof DigestReadError) return c.json(fail('READ_FAILED', err.message), 500);
    throw err;
  }
});

api.get('/starred', async (c) => {
  try {
    const items = await listStarred();
    return c.json(ok({ items }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(fail('READ_FAILED', msg), 500);
  }
});

api.post('/digests/:date/items/:id/star', async (c) => {
  const date = c.req.param('date');
  const id = c.req.param('id');
  if (!DATE_REGEX.test(date)) return c.json(fail('BAD_REQUEST', 'invalid date'), 400);
  if (!ITEM_ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail('BAD_REQUEST', 'invalid JSON'), 400);
  }
  const starred = (body as { starred?: unknown })?.starred;
  if (typeof starred !== 'boolean')
    return c.json(fail('BAD_REQUEST', 'starred must be boolean'), 400);
  try {
    const r = await toggleStar(date, id, starred);
    return c.json(ok(r));
  } catch (err) {
    if (err instanceof DigestNotFoundError) return c.json(fail(err.code, err.message), 404);
    if (err instanceof ItemNotFoundError) return c.json(fail(err.code, err.message), 404);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(fail('WRITE_FAILED', msg), 500);
  }
});

api.post('/run', async (c) => {
  const state = await readState();
  if (state.isRunning) return c.json(fail('RUN_IN_PROGRESS', 'a run is in progress'), 409);
  // Fire-and-forget; background promise captures its own errors into state.
  void runDigest({ force: true }).catch(() => {
    /* state.lastError is written inside runDigest */
  });
  return c.json(ok({ triggered: true as const }));
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter @cc/panel-ai-news test`
Expected: all PASS.

Run: `pnpm -r test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add panels/ai-news/api.ts panels/ai-news/api.test.ts
git commit -m "feat(panels/ai-news): HTTP routes with envelope + id/date guards"
```

---

## Task 6: Start the processor on boot + hourly tick

**Files:**
- Modify: `server/src/main.ts`

- [ ] **Step 1: Add the ai-news imports next to the braindump ones**

```ts
import { tick as aiNewsTick } from './lib/ai-news-processor';
```

- [ ] **Step 2: Schedule the boot kick + hourly tick inside `serve(...)` callback, after the braindump ticks**

After the braindump `setInterval(...)` block, add:

```ts
  void aiNewsTick().catch((err) =>
    logger.warn({ err: (err as Error).message }, 'ai-news boot tick failed'),
  );
  setInterval(() => {
    void aiNewsTick().catch((err) =>
      logger.warn({ err: (err as Error).message }, 'ai-news hourly tick failed'),
    );
  }, ONE_HOUR_MS);
```

- [ ] **Step 3: Verify the server starts cleanly**

Run: `pnpm dev` in one terminal. In another: `curl -s http://localhost:7778/api/ai-news/today`
Expected: an `Envelope` with `{"digest": null, "state": {"isRunning": false}}`. No warning about crashed boot tick.

(Then stop `pnpm dev`.)

- [ ] **Step 4: Run tests**

Run: `pnpm -r test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/main.ts
git commit -m "feat(server): start ai-news processor on boot + hourly tick"
```

---

## Task 7: UI — Digest tab (list + summary + refresh)

**Files:**
- Modify: `panels/ai-news/types.ts` (ensure all response types exported)
- Modify: `panels/ai-news/ui.tsx`
- Modify: `panels/ai-news/ui.module.css`

- [ ] **Step 1: Replace `panels/ai-news/ui.tsx` with the two-tab shell + Digest tab**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchJson } from '../../web/src/lib/fetchJson';
import {
  type AiNewsCategory,
  type AiNewsItem,
  type StarResponse,
  type StarredResponse,
  type TodayResponse,
} from './types';
import s from './ui.module.css';

const QK_TODAY = ['ai-news', 'today'] as const;
const QK_STARRED = ['ai-news', 'starred'] as const;

const CATEGORY_LABEL: Record<AiNewsCategory, string> = {
  tool: 'TOOL',
  model: 'MODEL',
  protocol: 'PROTO',
  research: 'RSRCH',
  community: 'COMM',
};

const CATEGORY_CLASS: Record<AiNewsCategory, string> = {
  tool: s.catTool ?? '',
  model: s.catModel ?? '',
  protocol: s.catProto ?? '',
  research: s.catRsrch ?? '',
  community: s.catComm ?? '',
};

type Tab = 'digest' | 'starred';

function formatRunAt(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const ItemRow = ({
  item,
  date,
  onToggleStar,
}: {
  item: AiNewsItem;
  date: string;
  onToggleStar: (args: { date: string; id: string; starred: boolean }) => void;
}) => (
  <div className={s.row}>
    <span className={`${s.pill} ${CATEGORY_CLASS[item.category]}`}>
      {CATEGORY_LABEL[item.category]}
    </span>
    <div className={s.rowBody}>
      <a
        className={s.rowTitle}
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {item.title}
      </a>
      <div className={s.rowSummary}>{item.oneLineSummary}</div>
    </div>
    <button
      type="button"
      className={s.star}
      aria-pressed={item.starred}
      title={item.starred ? 'Unstar' : 'Star'}
      onClick={() => onToggleStar({ date, id: item.id, starred: !item.starred })}
    >
      {item.starred ? '★' : '☆'}
    </button>
  </div>
);

export const UI = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('digest');

  const todayQuery = useQuery<TodayResponse>({
    queryKey: QK_TODAY,
    queryFn: () => fetchJson<TodayResponse>('/api/ai-news/today'),
    refetchInterval: (query) =>
      query.state.data?.state.isRunning ? 30_000 : false,
  });

  const starredQuery = useQuery<StarredResponse>({
    queryKey: QK_STARRED,
    queryFn: () => fetchJson<StarredResponse>('/api/ai-news/starred'),
    enabled: tab === 'starred',
  });

  const starMutation = useMutation({
    mutationFn: async ({
      date,
      id,
      starred,
    }: {
      date: string;
      id: string;
      starred: boolean;
    }) =>
      fetchJson<StarResponse>(
        `/api/ai-news/digests/${encodeURIComponent(date)}/items/${encodeURIComponent(id)}/star`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ starred }),
        },
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_TODAY });
      void qc.invalidateQueries({ queryKey: QK_STARRED });
    },
  });

  const runMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{ triggered: true }>('/api/ai-news/run', { method: 'POST' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_TODAY });
    },
  });

  const state = todayQuery.data?.state;
  const digest = todayQuery.data?.digest;
  const status = state?.isRunning
    ? 'Running…'
    : state?.lastError
      ? `Failed: ${state.lastError}`
      : state?.lastRunAt
        ? `Last run ${formatRunAt(state.lastRunAt)} · ${digest?.items.length ?? 0} items`
        : '';

  return (
    <div className={s.root}>
      <div className={s.header}>
        <div className={s.tabs}>
          <button
            type="button"
            className={tab === 'digest' ? s.tabActive : s.tab}
            onClick={() => setTab('digest')}
          >
            Digest
          </button>
          <button
            type="button"
            className={tab === 'starred' ? s.tabActive : s.tab}
            onClick={() => setTab('starred')}
          >
            Starred
          </button>
        </div>
        <button
          type="button"
          className={s.refresh}
          disabled={state?.isRunning || runMutation.isPending}
          onClick={() => runMutation.mutate()}
        >
          Refresh
        </button>
      </div>
      <div className={s.status}>{status}</div>

      {tab === 'digest' ? (
        digest ? (
          <>
            <div className={s.summary}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{digest.summary}</ReactMarkdown>
            </div>
            <div className={s.items}>
              {digest.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  date={digest.date}
                  onToggleStar={(args) => starMutation.mutate(args)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className={s.empty}>
            {state?.isRunning
              ? 'No digest yet today — running shortly.'
              : 'No digest yet today — click Refresh to generate one.'}
          </div>
        )
      ) : (
        <StarredTab
          query={starredQuery}
          onToggleStar={(args) => starMutation.mutate(args)}
        />
      )}
    </div>
  );
};

const StarredTab = ({
  query,
  onToggleStar,
}: {
  query: ReturnType<typeof useQuery<StarredResponse>>;
  onToggleStar: (args: { date: string; id: string; starred: boolean }) => void;
}) => {
  if (query.isLoading) return <div className={s.empty}>Loading…</div>;
  if (query.error)
    return <div className={s.empty}>Failed: {(query.error as Error).message}</div>;
  const items = query.data?.items ?? [];
  if (items.length === 0)
    return (
      <div className={s.empty}>
        Nothing starred yet — star items from the Digest tab to pin them here.
      </div>
    );
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const list = groups.get(item.digestDate) ?? [];
    list.push(item);
    groups.set(item.digestDate, list);
  }
  const dates = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));
  return (
    <div className={s.items}>
      {dates.map((date) => {
        const group = groups.get(date) ?? [];
        return (
          <div key={date}>
            <div className={s.dateHeader}>{date} · {group.length} starred</div>
            {group.map((item) => (
              <ItemRow key={item.id} item={item} date={date} onToggleStar={onToggleStar} />
            ))}
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: Replace `panels/ai-news/ui.module.css` with retrowave styling**

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  color: var(--text-primary);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.tabs {
  display: flex;
  gap: 4px;
}
.tab, .tabActive, .refresh {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
  border-radius: 3px;
}
.tabActive {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.refresh:disabled { opacity: 0.5; cursor: not-allowed; }
.status { font-size: 11px; color: var(--text-muted); min-height: 14px; }
.summary {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elev);
}
.summary p { margin: 0 0 6px; }
.summary p:last-child { margin-bottom: 0; }
.items { display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elev);
}
.rowBody { flex: 1; min-width: 0; }
.rowTitle {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rowTitle:hover { text-decoration: underline; }
.rowSummary { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
.pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.08em;
  align-self: center;
  min-width: 56px;
  text-align: center;
}
.catTool { background: rgba(139, 92, 246, 0.18); color: #c4b5fd; }
.catModel { background: rgba(236, 72, 153, 0.18); color: #f9a8d4; }
.catProto { background: rgba(34, 211, 238, 0.18); color: #67e8f9; }
.catRsrch { background: rgba(34, 197, 94, 0.18); color: #86efac; }
.catComm { background: rgba(245, 158, 11, 0.18); color: #fcd34d; }
.star {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
}
.star[aria-pressed='true'] { color: #facc15; }
.dateHeader {
  padding: 6px 2px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 4px;
}
```

- [ ] **Step 3: Run tests + build**

Run: `pnpm -r test`
Expected: all green.

Run: `pnpm --filter @cc/web build`
Expected: PASS (catches Record-type narrowings + `noUncheckedIndexedAccess` issues).

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Manual smoke (dev)**

Run: `pnpm dev`
Open http://localhost:5173. Click the AI News panel.
- Expected: two tabs visible, "No digest yet today — click Refresh to generate one." centered.
- Click Refresh. Expected: status flips to "Running…", button disabled, then once `claude -p` completes, the digest renders with 10 rows + summary.
- Click the star on one row. Expected: fills yellow, persists on refresh.
- Switch to Starred tab. Expected: that item appears grouped by today's date.

- [ ] **Step 5: Commit**

```bash
git add panels/ai-news/ui.tsx panels/ai-news/ui.module.css
git commit -m "feat(panels/ai-news): two-tab panel UI with star toggle"
```

---

## Task 8: Documentation + redeploy

**Files:**
- Modify: none (no README sections were defined for braindump, keep parity)
- Nothing to write — this task is verify + redeploy.

- [ ] **Step 1: Verify everything green**

Run: `pnpm fix`
Run: `pnpm -r test`
Run: `pnpm check`
Run: `pnpm --filter @cc/web build`
Expected: all PASS.

- [ ] **Step 2: Redeploy the prod daemon**

Run: `bash scripts/redeploy.sh`
Expected: exits with "redeployed — http://localhost:7777".

- [ ] **Step 3: Prod smoke**

Run: `curl -s http://localhost:7777/api/ai-news/today | head -c 200`
Expected: `{"ok":true,"data":{"digest":null,"state":{"isRunning":false}}}` (or a populated digest if the 7am tick already ran).

Visit http://localhost:7777 in the browser. Expected: AI News panel appears after Braindump. Click Refresh; digest eventually renders.

- [ ] **Step 4: No commit required** unless redeploy touched tracked files (it shouldn't — only `web/dist` changes, which is gitignored).

---

## Self-review notes

- Spec coverage: §4 → Tasks 1 + 6; §5 (types/storage) → Tasks 1, 2; §6 (LLM contract) → Tasks 3, 4; §7 (scheduler) → Task 4; §8 (API) → Task 5; §9 (UI) → Task 7; §11 (testing) covered in Tasks 2-5, 7.
- No TBDs or placeholder steps.
- `extractJson` is imported from `braindump-processor` (already exported) — no duplication.
- `noUncheckedIndexedAccess` compatibility: `group` from `groups.get(date)` uses `?? []` fallback. `digest.items[0]!` in tests uses non-null assertion intentionally after `toHaveLength(1)` assertion.
- The `HOME` env-var trick in `api.test.ts` is how the lib's `os.homedir()` fallback gets redirected; matches the pattern used in braindump's tests implicitly.
