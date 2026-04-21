# Journals Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New `Journals` panel that lists every entry in `~/.claude/journals/{daily,weekly,monthly}/` across three tabs, with click-to-expand inline markdown rendering for each row.

**Architecture:** New `server/src/lib/journals.ts` globs the three tier directories, parses YAML frontmatter via `gray-matter`, and exposes `listJournals` (metadata for all three tiers) plus `readJournalBody` (one entry's markdown). Module-level `Map` cache keyed by `(path, mtime, size)` mirrors Spec 2's pattern. New `panels/journals/` workspace renders three tabs, accordion rows, and `react-markdown` + `remark-gfm` body rendering.

**Tech Stack:** TypeScript strict, Hono, React 18 + TanStack Query, react-markdown + remark-gfm, gray-matter, Vitest, Biome, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-04-20-journals-panel-design.md`

---

## File Structure

**New (server + deps):**
- `server/src/lib/journals.ts` — `listJournals`, `readJournalBody`, types, errors
- `server/src/lib/journals.test.ts` — unit tests
- `server/package.json` gains `gray-matter` dep + `./lib/journals` export

**New (panel workspace):**
- `panels/journals/package.json` — adds `react-markdown` + `remark-gfm` deps
- `panels/journals/tsconfig.json`
- `panels/journals/meta.ts`
- `panels/journals/types.ts`
- `panels/journals/api.ts`
- `panels/journals/api.test.ts`
- `panels/journals/ui.tsx`
- `panels/journals/ui.module.css`

**Changed:**
- `web/src/panels.ts` (register UI, order 50)
- `server/src/routes.ts` (register API at `/api/journals`)

## Task Decomposition

Eight tasks, each leaving the workspace building and testable:

1. `listJournals` orchestrator with frontmatter parsing + cache
2. `readJournalBody` reader + custom errors
3. Panel workspace scaffold + registry wiring (stubs)
4. API handlers (`GET /` + `GET /:tier/:id`)
5. UI tabs + row list (no expand yet)
6. UI accordion + lazy markdown body rendering
7. UI polish (per-row label tweaks per tier, error/empty states)
8. Final verification (lint + tests + typecheck + build + smoke)

---

## Task 1: `listJournals` orchestrator with frontmatter parsing + cache

**Files:**
- Create: `server/src/lib/journals.ts`
- Create: `server/src/lib/journals.test.ts`
- Modify: `server/package.json` (add `gray-matter` dep + `./lib/journals` export)

Streams all three tier directories, parses frontmatter into normalized `JournalSummary` objects, sorts each tier by `id` desc, and caches per-file by `(mtime, size)`. Same shape as Spec 2's `listRecentSessions`.

- [ ] **Step 1: Add the dep + export**

Edit `server/package.json`:

```json
{
  "name": "@cc/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./envelope": "./src/envelope.ts",
    "./lib/git": "./src/lib/git.ts",
    "./lib/gh": "./src/lib/gh.ts",
    "./lib/sessions": "./src/lib/sessions.ts",
    "./lib/journals": "./src/lib/journals.ts"
  },
  "scripts": { "dev": "SERVE_STATIC=false PORT=7778 tsx watch src/main.ts", "build": "tsc -p tsconfig.json --noEmit", "start": "tsx src/main.ts", "test": "vitest run", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "dependencies": {
    "@cc/shared": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "gray-matter": "^4.0.3",
    "hono": "^4.6.14",
    "pino": "^9.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

(Keep the existing `scripts` block formatting — only add the export entry, the dep, and don't reflow other lines. The block above is the canonical end state — read the actual file before editing and apply minimal changes.)

Run: `pnpm install`. Expected: `gray-matter` and its tiny transitive deps install; lockfile updates.

- [ ] **Step 2: Write the failing tests**

Create `server/src/lib/journals.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

describe('listJournals', () => {
  type Deps = NonNullable<Parameters<typeof import('./journals').listJournals>[0]>;

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    return {
      home: '/home/u',
      globber: async () => [],
      stat: async () => ({ mtimeMs: 1, size: 1 }),
      readFile: async () => '',
      ...overrides,
    };
  }

  test('returns empty arrays when journals dir is empty', async () => {
    const { listJournals } = await import('./journals');
    const result = await listJournals(makeDeps({ clearCache: true }));
    expect(result).toEqual({ daily: [], weekly: [], monthly: [] });
  });

  test('parses daily frontmatter into JournalSummary', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
date: 2026-04-20
session: 1
source: session
repos: [control-center]
started: 15:45
ended: 16:00
---

## Completed
- Did stuff
`,
    });
    const result = await listJournals(deps);
    expect(result.daily).toEqual([
      {
        id: '2026-04-20',
        tier: 'daily',
        date: '2026-04-20',
        repos: ['control-center'],
        sessions: 1,
      },
    ]);
    expect(result.weekly).toEqual([]);
    expect(result.monthly).toEqual([]);
  });

  test('parses weekly frontmatter with period field', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/weekly/') ? ['/home/u/.claude/journals/weekly/2026-W17.md'] : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
type: weekly
week: 2026-W17
period: 2026-04-20 to 2026-04-26
sessions: 3
repos: [control-center, integrations]
---

## Summary
Stuff happened.
`,
    });
    const result = await listJournals(deps);
    expect(result.weekly).toEqual([
      {
        id: '2026-W17',
        tier: 'weekly',
        date: '2026-W17',
        repos: ['control-center', 'integrations'],
        sessions: 3,
        period: '2026-04-20 to 2026-04-26',
      },
    ]);
  });

  test('parses monthly frontmatter without period', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/monthly/') ? ['/home/u/.claude/journals/monthly/2026-04.md'] : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
type: monthly
month: 2026-04
sessions: 18
repos: [control-center]
---

## Highlights
Things.
`,
    });
    const result = await listJournals(deps);
    expect(result.monthly[0]?.id).toBe('2026-04');
    expect(result.monthly[0]?.sessions).toBe(18);
    expect(result.monthly[0]?.period).toBeUndefined();
  });

  test('sort order — same-day suffixes first, then base, then older days', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/')
          ? [
              '/home/u/.claude/journals/daily/2026-04-19.md',
              '/home/u/.claude/journals/daily/2026-04-20.md',
              '/home/u/.claude/journals/daily/2026-04-20-2.md',
              '/home/u/.claude/journals/daily/2026-04-20-3.md',
            ]
          : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
session: 1
repos: [r]
---
body
`,
    });
    const result = await listJournals(deps);
    expect(result.daily.map((j) => j.id)).toEqual([
      '2026-04-20-3',
      '2026-04-20-2',
      '2026-04-20',
      '2026-04-19',
    ]);
  });

  test('missing repos field coerces to []', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
session: 1
---
body
`,
    });
    const result = await listJournals(deps);
    expect(result.daily[0]?.repos).toEqual([]);
    expect(result.daily[0]?.sessions).toBe(1);
  });

  test('non-array repos field coerces to []', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
session: 1
repos: control-center
---
body
`,
    });
    const result = await listJournals(deps);
    expect(result.daily[0]?.repos).toEqual([]);
  });

  test('missing sessions field returns null for weekly/monthly', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/weekly/') ? ['/home/u/.claude/journals/weekly/2026-W17.md'] : [],
      stat: async () => ({ mtimeMs: 100, size: 200 }),
      readFile: async () => `---
type: weekly
period: 2026-04-20 to 2026-04-26
---
body
`,
    });
    const result = await listJournals(deps);
    expect(result.weekly[0]?.sessions).toBeNull();
  });

  test('cache hit when (mtime, size) match; re-parses when mtime changes', async () => {
    const { listJournals } = await import('./journals');
    let readCalls = 0;
    const buildDeps = (mtime: number) =>
      makeDeps({
        globber: async (pattern: string) =>
          pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
        stat: async () => ({ mtimeMs: mtime, size: 1 }),
        readFile: async () => {
          readCalls++;
          return `---
session: 1
repos: [r]
---
body
`;
        },
      });

    // Call 1 — cold cache
    await listJournals({ ...buildDeps(100), clearCache: true });
    expect(readCalls).toBe(1);

    // Call 2 — same mtime, should hit cache
    await listJournals(buildDeps(100));
    expect(readCalls).toBe(1);

    // Call 3 — mtime changed
    await listJournals(buildDeps(200));
    expect(readCalls).toBe(2);
  });

  test('evicts cache entries for files no longer in the glob result', async () => {
    const { listJournals } = await import('./journals');
    let readCalls = 0;
    const baseDeps = {
      home: '/home/u',
      stat: async () => ({ mtimeMs: 100, size: 1 }),
      readFile: async () => {
        readCalls++;
        return `---
session: 1
repos: [r]
---
body
`;
      },
    };

    // Call 1 — file present, parsed and cached
    await listJournals({
      ...baseDeps,
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
    });
    expect(readCalls).toBe(1);

    // Call 2 — file gone, no entry returned, cache evicted
    const r2 = await listJournals({
      ...baseDeps,
      globber: async () => [],
    });
    expect(r2.daily).toEqual([]);

    // Call 3 — file back, must re-parse (proving the cache was evicted, not stale-hit)
    await listJournals({
      ...baseDeps,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
    });
    expect(readCalls).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
pnpm --filter @cc/server test journals.test
```
Expected: all 9 tests fail with `Cannot find module './journals'` or `listJournals is not a function`.

- [ ] **Step 4: Implement `listJournals`**

Create `server/src/lib/journals.ts`:

```ts
import fs from 'node:fs';
import { glob as nativeGlob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import { logger } from '../logger';

export type Tier = 'daily' | 'weekly' | 'monthly';

export type JournalSummary = {
  id: string;
  tier: Tier;
  date: string;
  repos: string[];
  sessions: number | null;
  period?: string;
};

export type ListResponse = {
  daily: JournalSummary[];
  weekly: JournalSummary[];
  monthly: JournalSummary[];
};

export type ListDeps = {
  home?: string;
  globber?: (pattern: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number; size: number }>;
  readFile?: (p: string) => Promise<string>;
  clearCache?: boolean;
};

type CacheEntry = { mtime: number; size: number; parsed: JournalSummary };
const cache = new Map<string, CacheEntry>();

const TIERS: Tier[] = ['daily', 'weekly', 'monthly'];

const defaultGlobber = async (pattern: string): Promise<string[]> => {
  const out: string[] = [];
  for await (const entry of nativeGlob(pattern)) out.push(entry as string);
  return out;
};

const defaultStat = async (p: string): Promise<{ mtimeMs: number; size: number }> => {
  const s = await fs.promises.stat(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
};

const defaultReadFile = async (p: string): Promise<string> => fs.promises.readFile(p, 'utf8');

function coerceRepos(value: unknown): string[] {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  return [];
}

function coerceSessions(data: Record<string, unknown>): number | null {
  // Daily uses `session` (sequence number); weekly/monthly use `sessions` (count).
  if (typeof data.session === 'number') return data.session;
  if (typeof data.sessions === 'number') return data.sessions;
  return null;
}

function buildSummary(filePath: string, tier: Tier, raw: string): JournalSummary {
  const id = path.basename(filePath, '.md');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const summary: JournalSummary = {
    id,
    tier,
    date: typeof data.date === 'string' ? data.date : id,
    repos: coerceRepos(data.repos),
    sessions: coerceSessions(data),
  };

  if (Array.isArray(data.repos) === false && data.repos !== undefined) {
    logger.warn({ tier, id }, 'journal repos frontmatter is not an array; coerced to []');
  }

  if (typeof data.period === 'string') {
    summary.period = data.period;
  }
  return summary;
}

export async function listJournals(deps: ListDeps = {}): Promise<ListResponse> {
  if (deps.clearCache) cache.clear();
  const home = deps.home ?? os.homedir();
  const globber = deps.globber ?? defaultGlobber;
  const stat = deps.stat ?? defaultStat;
  const readFile = deps.readFile ?? defaultReadFile;

  const surviving = new Set<string>();
  const result: ListResponse = { daily: [], weekly: [], monthly: [] };

  for (const tier of TIERS) {
    const pattern = path.join(home, '.claude', 'journals', tier, '*.md');
    const files = await globber(pattern);

    for (const filePath of files) {
      const st = await stat(filePath).catch((err) => {
        logger.warn({ filePath, err: (err as Error)?.message }, 'journals stat failed; skipping');
        return null;
      });
      if (!st) continue;
      surviving.add(filePath);

      let entry = cache.get(filePath);
      if (!entry || entry.mtime !== st.mtimeMs || entry.size !== st.size) {
        try {
          const raw = await readFile(filePath);
          const parsed = buildSummary(filePath, tier, raw);
          entry = { mtime: st.mtimeMs, size: st.size, parsed };
          cache.set(filePath, entry);
        } catch (err) {
          logger.warn(
            { filePath, err: (err as Error)?.message },
            'journals parse failed; skipping',
          );
          continue;
        }
      }

      result[tier].push(entry.parsed);
    }

    result[tier].sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
  }

  for (const key of [...cache.keys()]) {
    if (!surviving.has(key)) cache.delete(key);
  }

  return result;
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test journals.test
```
Expected: 9/9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/src/lib/journals.ts server/src/lib/journals.test.ts pnpm-lock.yaml
git commit -m "feat(server): listJournals orchestrator with frontmatter parsing + cache"
```

---

## Task 2: `readJournalBody` reader + custom errors

**Files:**
- Modify: `server/src/lib/journals.ts`
- Modify: `server/src/lib/journals.test.ts`

Single-file reader that strips frontmatter and returns the markdown body. Throws typed errors so the API handler can map to 404/500.

- [ ] **Step 1: Append failing tests**

Append to `server/src/lib/journals.test.ts`:

```ts
describe('readJournalBody', () => {
  type Deps = NonNullable<Parameters<typeof import('./journals').readJournalBody>[2]>;

  test('strips frontmatter and returns markdown body', async () => {
    const { readJournalBody } = await import('./journals');
    const deps: Deps = {
      home: '/home/u',
      readFile: async () => `---
date: 2026-04-20
session: 1
---

## Completed
- Did stuff
`,
    };
    const body = await readJournalBody('daily', '2026-04-20', deps);
    expect(body).toBe('\n## Completed\n- Did stuff\n');
  });

  test('returns empty string for body-less journal', async () => {
    const { readJournalBody } = await import('./journals');
    const deps: Deps = {
      home: '/home/u',
      readFile: async () => `---
date: 2026-04-20
---
`,
    };
    const body = await readJournalBody('daily', '2026-04-20', deps);
    expect(body).toBe('');
  });

  test('throws JournalNotFoundError on ENOENT', async () => {
    const { readJournalBody, JournalNotFoundError } = await import('./journals');
    const deps: Deps = {
      home: '/home/u',
      readFile: async () => {
        const err = new Error("ENOENT: no such file or directory, open 'foo'") as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    };
    await expect(readJournalBody('daily', 'missing', deps)).rejects.toBeInstanceOf(
      JournalNotFoundError,
    );
  });

  test('throws JournalReadError on other filesystem errors', async () => {
    const { readJournalBody, JournalReadError } = await import('./journals');
    const deps: Deps = {
      home: '/home/u',
      readFile: async () => {
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };
    await expect(readJournalBody('daily', '2026-04-20', deps)).rejects.toBeInstanceOf(
      JournalReadError,
    );
  });

  test('resolves path inside the correct tier directory', async () => {
    const { readJournalBody } = await import('./journals');
    const calls: string[] = [];
    const deps: Deps = {
      home: '/home/u',
      readFile: async (p: string) => {
        calls.push(p);
        return `---
type: weekly
---
hi
`;
      },
    };
    await readJournalBody('weekly', '2026-W17', deps);
    expect(calls).toEqual(['/home/u/.claude/journals/weekly/2026-W17.md']);
  });
});
```

- [ ] **Step 2: Run tests — confirm new ones fail**

```bash
pnpm --filter @cc/server test journals.test
```
Expected: 5 new tests fail with `readJournalBody is not a function` or `JournalNotFoundError is not a function`.

- [ ] **Step 3: Implement**

Append to `server/src/lib/journals.ts`:

```ts
export class JournalNotFoundError extends Error {
  readonly code = 'JOURNAL_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'JournalNotFoundError';
  }
}

export class JournalReadError extends Error {
  readonly code = 'READ_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'JournalReadError';
  }
}

export type ReadDeps = {
  home?: string;
  readFile?: (p: string) => Promise<string>;
};

export async function readJournalBody(
  tier: Tier,
  id: string,
  deps: ReadDeps = {},
): Promise<string> {
  const home = deps.home ?? os.homedir();
  const readFile = deps.readFile ?? defaultReadFile;
  const filePath = path.join(home, '.claude', 'journals', tier, `${id}.md`);
  let raw: string;
  try {
    raw = await readFile(filePath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') {
      throw new JournalNotFoundError(`journal not found: ${tier}/${id}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ tier, id, err: msg }, 'journal read failed');
    throw new JournalReadError(msg.slice(0, 200));
  }
  return matter(raw).content;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test journals.test
```
Expected: 14/14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/journals.ts server/src/lib/journals.test.ts
git commit -m "feat(server): readJournalBody with typed not-found / read errors"
```

---

## Task 3: Panel workspace scaffold + registry wiring (stubs)

**Files:**
- Create: `panels/journals/package.json`
- Create: `panels/journals/tsconfig.json`
- Create: `panels/journals/meta.ts`
- Create: `panels/journals/types.ts`
- Create: `panels/journals/api.ts` (stub)
- Create: `panels/journals/ui.tsx` (stub)
- Create: `panels/journals/ui.module.css` (empty)
- Modify: `web/src/panels.ts`
- Modify: `server/src/routes.ts`

Leaves the dashboard building, with the new panel rendering a "loading… (scaffold)" placeholder and `/api/journals` returning 501. Task 4 fills handlers; Tasks 5–7 fill the UI.

- [ ] **Step 1: Create the workspace's `package.json`**

Create `panels/journals/package.json`:

```json
{
  "name": "@cc/panel-journals",
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

(`--passWithNoTests` matches the Spec 2 panel's interim state until Task 4 adds the test file.)

- [ ] **Step 2: Create `tsconfig.json`, `meta.ts`, `types.ts`**

`panels/journals/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

`panels/journals/meta.ts`:

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'journals',
  title: 'Journals',
  order: 50,
  defaultSize: 'md',
};
```

`panels/journals/types.ts`:

```ts
export type Tier = 'daily' | 'weekly' | 'monthly';

export type JournalSummary = {
  id: string;
  tier: Tier;
  date: string;
  repos: string[];
  sessions: number | null;
  period?: string;
};

export type ListResponse = {
  daily: JournalSummary[];
  weekly: JournalSummary[];
  monthly: JournalSummary[];
};

export type BodyResponse = {
  body: string;
};
```

- [ ] **Step 3: Create API + UI stubs**

Create `panels/journals/api.ts`:

```ts
import { fail } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', (c) => c.json(fail('NOT_IMPLEMENTED', 'journals API coming in Task 4'), 501));
api.get('/:tier/:id', (c) =>
  c.json(fail('NOT_IMPLEMENTED', 'journals body API coming in Task 4'), 501),
);
```

Create `panels/journals/ui.tsx`:

```tsx
export const UI = () => (
  <div className="panel">
    <div className="panel-header">Journals</div>
    <div className="panel-body">
      <p style={{ color: 'var(--fg-dim)' }}>loading… (scaffold)</p>
    </div>
  </div>
);
```

Create `panels/journals/ui.module.css` as an empty file (Tasks 5–7 populate it).

- [ ] **Step 4: Register in both registries**

Edit `web/src/panels.ts` — final shape:

```ts
import type { PanelMeta, PanelUI } from '@cc/shared';
import { meta as sessionsMeta } from '../../panels/claude-sessions/meta';
import { UI as sessionsUI } from '../../panels/claude-sessions/ui';
import { meta as journalsMeta } from '../../panels/journals/meta';
import { UI as journalsUI } from '../../panels/journals/ui';
import { meta as prsMeta } from '../../panels/pull-requests/meta';
import { UI as prsUI } from '../../panels/pull-requests/ui';
import { meta as shortcutsMeta } from '../../panels/shortcuts/meta';
import { UI as shortcutsUI } from '../../panels/shortcuts/ui';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';
import { UI as worktreesUI } from '../../panels/worktrees/ui';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
  { meta: prsMeta, UI: prsUI },
  { meta: shortcutsMeta, UI: shortcutsUI },
  { meta: sessionsMeta, UI: sessionsUI },
  { meta: journalsMeta, UI: journalsUI },
];
```

Edit `server/src/routes.ts` — final shape:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { api as sessionsApi } from '../../panels/claude-sessions/api';
import { api as journalsApi } from '../../panels/journals/api';
import { api as prsApi } from '../../panels/pull-requests/api';
import { api as shortcutsApi } from '../../panels/shortcuts/api';
import { api as worktreesApi } from '../../panels/worktrees/api';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGOS = path.resolve(HERE, '..', '..', 'config', 'logos');

export function registerRoutes(app: Hono): void {
  app.route('/api/worktrees', worktreesApi);
  app.route('/api/pull-requests', prsApi);
  app.route('/api/shortcuts', shortcutsApi);
  app.route('/api/claude-sessions', sessionsApi);
  app.route('/api/journals', journalsApi);
  app.use(
    '/logos/*',
    serveStatic({
      root: LOGOS,
      rewriteRequestPath: (p) => p.replace(/^\/logos/, ''),
    }),
  );
}
```

- [ ] **Step 5: Install + verify**

```bash
pnpm install
```
Expected: `react-markdown`, `remark-gfm`, and their narrow transitive deps install. Lockfile updates.

```bash
pnpm -r test
```
Expected: all existing tests still pass.

```bash
pnpm --filter @cc/server build
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add panels/journals pnpm-lock.yaml web/src/panels.ts server/src/routes.ts
git commit -m "feat(panels/journals): scaffold workspace and wire into registries"
```

---

## Task 4: API handlers (`GET /` + `GET /:tier/:id`)

**Files:**
- Modify: `panels/journals/api.ts`
- Create: `panels/journals/api.test.ts`

`GET /` calls `listJournals`, returns envelope. `GET /:tier/:id` validates tier + id, calls `readJournalBody`, maps the typed errors to status codes.

- [ ] **Step 1: Write the failing tests**

Create `panels/journals/api.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/journals', () => ({
  listJournals: vi.fn(async () => ({ daily: [], weekly: [], monthly: [] })),
  readJournalBody: vi.fn(async () => ''),
  JournalNotFoundError: class JournalNotFoundError extends Error {
    code = 'JOURNAL_NOT_FOUND';
  },
  JournalReadError: class JournalReadError extends Error {
    code = 'READ_FAILED';
  },
}));

const sampleSummary = {
  id: '2026-04-20',
  tier: 'daily' as const,
  date: '2026-04-20',
  repos: ['control-center'],
  sessions: 3,
};

describe('journals api', () => {
  test('GET / returns envelope with all three tiers', async () => {
    const svc = await import('@cc/server/lib/journals');
    (svc.listJournals as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      daily: [sampleSummary],
      weekly: [],
      monthly: [],
    });
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.daily).toHaveLength(1);
    expect(body.data.weekly).toEqual([]);
    expect(body.data.monthly).toEqual([]);
  });

  test('GET /:tier/:id returns 200 with body on success', async () => {
    const svc = await import('@cc/server/lib/journals');
    (svc.readJournalBody as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '## Completed\n- Did stuff\n',
    );
    const { api } = await import('./api');
    const res = await api.request('/daily/2026-04-20');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { body: '## Completed\n- Did stuff\n' } });
    expect(svc.readJournalBody).toHaveBeenCalledWith('daily', '2026-04-20');
  });

  test('GET /:tier/:id returns 400 BAD_REQUEST on invalid tier', async () => {
    const { api } = await import('./api');
    const res = await api.request('/unknown/2026-04-20');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('GET /:tier/:id returns 400 BAD_REQUEST on traversal-style id', async () => {
    const { api } = await import('./api');
    const res = await api.request('/daily/..%2Ffoo');
    // ..%2F decodes to ../foo which fails the [A-Za-z0-9-]+ check
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('GET /:tier/:id returns 404 JOURNAL_NOT_FOUND when file missing', async () => {
    const svc = await import('@cc/server/lib/journals');
    const NotFound = svc.JournalNotFoundError as new (m: string) => Error;
    (svc.readJournalBody as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NotFound('missing'),
    );
    const { api } = await import('./api');
    const res = await api.request('/daily/2099-01-01');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('JOURNAL_NOT_FOUND');
  });

  test('GET /:tier/:id returns 500 READ_FAILED on filesystem error', async () => {
    const svc = await import('@cc/server/lib/journals');
    const ReadErr = svc.JournalReadError as new (m: string) => Error;
    (svc.readJournalBody as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ReadErr('EACCES'),
    );
    const { api } = await import('./api');
    const res = await api.request('/daily/2026-04-20');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('READ_FAILED');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/panel-journals test
```
Expected: 6 tests fail because handlers still return 501.

- [ ] **Step 3: Implement the handlers**

Replace `panels/journals/api.ts` with:

```ts
import { fail, ok } from '@cc/server/envelope';
import {
  JournalNotFoundError,
  JournalReadError,
  listJournals,
  readJournalBody,
} from '@cc/server/lib/journals';
import { Hono } from 'hono';

const VALID_TIERS = new Set(['daily', 'weekly', 'monthly']);
const ID_PATTERN = /^[A-Za-z0-9-]+$/;

export const api = new Hono();

api.get('/', async (c) => {
  const data = await listJournals();
  return c.json(ok(data));
});

api.get('/:tier/:id', async (c) => {
  const tier = c.req.param('tier');
  const id = c.req.param('id');
  if (!VALID_TIERS.has(tier) || !ID_PATTERN.test(id)) {
    return c.json(fail('BAD_REQUEST', 'invalid tier or id'), 400);
  }
  try {
    const body = await readJournalBody(tier as 'daily' | 'weekly' | 'monthly', id);
    return c.json(ok({ body }));
  } catch (err) {
    if (err instanceof JournalNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    if (err instanceof JournalReadError) {
      return c.json(fail(err.code, err.message), 500);
    }
    throw err;
  }
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @cc/panel-journals test
```
Expected: 6/6 pass.

```bash
pnpm -r test
```
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add panels/journals/api.ts panels/journals/api.test.ts
git commit -m "feat(panels/journals): GET list + GET body handlers with validation"
```

---

## Task 5: UI tabs + row list (no expand yet)

**Files:**
- Modify: `panels/journals/ui.tsx`
- Modify: `panels/journals/ui.module.css`

Three tabs (Daily / Weekly / Monthly), each rendering its tier's rows with metadata only. Click handlers and accordion expand land in Task 6 — keep this diff focused.

- [ ] **Step 1: Populate CSS**

Replace `panels/journals/ui.module.css` with:

```css
.tabs {
  display: flex;
  gap: 16px;
  border-bottom: 1px solid var(--fg-dim);
  margin-bottom: 10px;
}
.tab {
  background: transparent;
  border: none;
  color: var(--fg-dim);
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1px;
  padding: 6px 0;
  cursor: pointer;
  text-transform: uppercase;
  border-bottom: 2px solid transparent;
}
.tab:hover {
  color: var(--fg);
}
.tabActive {
  color: var(--pink);
  border-bottom-color: var(--pink);
  text-shadow: var(--glow-pink);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
  color: var(--fg);
}
.chevron {
  color: var(--fg-dim);
  width: 12px;
  display: inline-block;
  text-align: center;
}
.rowDate {
  color: var(--cyan);
  font-weight: bold;
}
.rowMeta {
  color: var(--fg-dim);
  font-size: 11px;
}
.empty {
  color: var(--fg-dim);
  font-style: italic;
  padding: 8px 0;
}
```

- [ ] **Step 2: Replace `ui.tsx`**

Replace `panels/journals/ui.tsx` with:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { JournalSummary, ListResponse, Tier } from './types';
import s from './ui.module.css';

const QK = ['journals'] as const;
const TIER_LABELS: Record<Tier, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function rowMeta(row: JournalSummary): string {
  const reposPart = row.repos.length > 0 ? row.repos.join(', ') : '—';
  const sessionPart =
    row.sessions === null
      ? '— sessions'
      : row.tier === 'daily'
        ? `Session ${row.sessions}`
        : `${row.sessions} session${row.sessions === 1 ? '' : 's'}`;
  const periodPart = row.period ? ` · ${row.period}` : '';
  return `${reposPart} · ${sessionPart}${periodPart}`;
}

export const UI = () => {
  const [tier, setTier] = useState<Tier>('daily');
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/journals'),
  });

  const rows = data?.[tier] ?? [];

  return (
    <div className="panel">
      <div className="panel-header">
        Journals
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        <div className={s.tabs}>
          {(['daily', 'weekly', 'monthly'] as Tier[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${s.tab} ${t === tier ? s.tabActive : ''}`}
              onClick={() => setTier(t)}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && rows.length === 0 && <p className={s.empty}>No {tier} journals yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className={s.row}>
            <span className={s.chevron} aria-hidden="true">
              ▸
            </span>
            <span className={s.rowDate}>{row.id}</span>
            <span className={s.rowMeta}>{rowMeta(row)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm -r test
```
Expected: all suites green.

- [ ] **Step 4: Commit**

```bash
git add panels/journals/ui.tsx panels/journals/ui.module.css
git commit -m "feat(panels/journals): three-tab list view with per-tier row labels"
```

---

## Task 6: UI accordion + lazy markdown body rendering

**Files:**
- Modify: `panels/journals/ui.tsx`
- Modify: `panels/journals/ui.module.css`

Adds click-to-expand accordion (one open at a time per tier), a lazy TanStack Query keyed by `(tier, id)` that fires only when expanded, and `react-markdown` rendering inside the body block.

- [ ] **Step 1: Append CSS for the accordion body**

Append to `panels/journals/ui.module.css`:

```css
.rowClickable {
  cursor: pointer;
  transition: background 80ms ease;
}
.rowClickable:hover {
  background: rgba(255, 128, 255, 0.06);
}
.body {
  border-left: 2px solid var(--cyan);
  padding: 8px 12px 12px 16px;
  margin: 4px 0 8px 12px;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.5;
}
.body h1, .body h2, .body h3, .body h4 {
  color: var(--pink);
  margin-top: 12px;
  margin-bottom: 6px;
}
.body h1 { font-size: 16px; }
.body h2 { font-size: 14px; }
.body h3 { font-size: 13px; }
.body code {
  background: rgba(0, 240, 255, 0.06);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 12px;
}
.body pre {
  background: var(--bg-mid);
  padding: 8px;
  border-radius: 3px;
  overflow-x: auto;
  font-size: 12px;
}
.body pre code {
  background: transparent;
  padding: 0;
}
.body ul, .body ol {
  padding-left: 20px;
  margin: 6px 0;
}
.body a {
  color: var(--cyan);
}
.bodyLoading {
  color: var(--fg-dim);
  font-size: 12px;
  font-style: italic;
}
.bodyError {
  color: var(--danger);
  font-size: 12px;
}
.bodyEmpty {
  color: var(--fg-dim);
  font-size: 12px;
  font-style: italic;
}
```

- [ ] **Step 2: Update `ui.tsx`**

Replace `panels/journals/ui.tsx` with:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { BodyResponse, JournalSummary, ListResponse, Tier } from './types';
import s from './ui.module.css';

const QK = ['journals'] as const;
const TIER_LABELS: Record<Tier, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function rowMeta(row: JournalSummary): string {
  const reposPart = row.repos.length > 0 ? row.repos.join(', ') : '—';
  const sessionPart =
    row.sessions === null
      ? '— sessions'
      : row.tier === 'daily'
        ? `Session ${row.sessions}`
        : `${row.sessions} session${row.sessions === 1 ? '' : 's'}`;
  const periodPart = row.period ? ` · ${row.period}` : '';
  return `${reposPart} · ${sessionPart}${periodPart}`;
}

const JournalBody = ({ tier, id }: { tier: Tier; id: string }) => {
  const { data, isLoading, error } = useQuery<BodyResponse>({
    queryKey: ['journal-body', tier, id] as const,
    queryFn: () => fetchJson<BodyResponse>(`/api/journals/${tier}/${encodeURIComponent(id)}`),
  });
  if (isLoading) return <div className={s.bodyLoading}>loading…</div>;
  if (error) return <div className={s.bodyError}>{(error as Error).message}</div>;
  if (!data || data.body.trim() === '') return <div className={s.bodyEmpty}>(empty journal)</div>;
  return (
    <div className={s.body}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.body}</ReactMarkdown>
    </div>
  );
};

export const UI = () => {
  const [tier, setTier] = useState<Tier>('daily');
  const [openByTier, setOpenByTier] = useState<Record<Tier, string | null>>({
    daily: null,
    weekly: null,
    monthly: null,
  });
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/journals'),
  });

  const rows = data?.[tier] ?? [];
  const openId = openByTier[tier];
  const toggle = (id: string) => {
    setOpenByTier((prev) => ({ ...prev, [tier]: prev[tier] === id ? null : id }));
  };

  return (
    <div className="panel">
      <div className="panel-header">
        Journals
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        <div className={s.tabs}>
          {(['daily', 'weekly', 'monthly'] as Tier[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${s.tab} ${t === tier ? s.tabActive : ''}`}
              onClick={() => setTier(t)}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && rows.length === 0 && <p className={s.empty}>No {tier} journals yet.</p>}
        {rows.map((row) => {
          const isOpen = openId === row.id;
          return (
            <div key={row.id}>
              <div
                className={`${s.row} ${s.rowClickable}`}
                onClick={() => toggle(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(row.id);
                  }
                }}
                // biome-ignore lint/a11y/useSemanticElements: row is a flex layout; native <button> would break the visual row contract.
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
              >
                <span className={s.chevron} aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className={s.rowDate}>{row.id}</span>
                <span className={s.rowMeta}>{rowMeta(row)}</span>
              </div>
              {isOpen && <JournalBody tier={tier} id={row.id} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm -r test
```
Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add panels/journals/ui.tsx panels/journals/ui.module.css
git commit -m "feat(panels/journals): accordion expand with lazy markdown body fetch"
```

---

## Task 7: UI polish — keyboard chevron rotation + body cleanup

**Files:**
- Modify: `panels/journals/ui.module.css`

Small visual cleanup pass — the body's left border should connect visually to the row above when expanded, and code blocks need a min-width guard so wide command lines don't overflow the panel.

- [ ] **Step 1: Append final CSS tweaks**

Append to `panels/journals/ui.module.css`:

```css
.rowClickable[aria-expanded="true"] .chevron {
  color: var(--cyan);
}
.body pre {
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
}
.body p {
  margin: 6px 0;
}
.body blockquote {
  border-left: 2px solid var(--fg-dim);
  margin: 6px 0;
  padding-left: 10px;
  color: var(--fg-dim);
  font-style: italic;
}
.body table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}
.body th, .body td {
  border: 1px solid var(--fg-dim);
  padding: 4px 8px;
}
.body th {
  background: var(--bg-mid);
  color: var(--fg);
}
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm -r test
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add panels/journals/ui.module.css
git commit -m "feat(panels/journals): polish body rendering (tables, blockquote, code wrap)"
```

---

## Task 8: Final verification

- [ ] **Step 1: Biome autofix**

```bash
pnpm fix
```
Expected: exit 0. If Biome touches files, stage them for the cleanup commit at the end.

- [ ] **Step 2: Lint check**

```bash
pnpm check
```
Expected: exit 0, no diagnostics.

- [ ] **Step 3: Full test suite**

```bash
pnpm -r test
```
Expected: all suites pass, including the 14 new sessions/journals tests on top of the existing total.

- [ ] **Step 4: Server typecheck**

```bash
pnpm --filter @cc/server build
```
Expected: exit 0.

- [ ] **Step 5: Web typecheck + build**

```bash
pnpm --filter @cc/web build
```
Expected: exit 0. (This is the one Task 10 of Spec 2 missed — `tsc -b && vite build` catches type errors the server-only check doesn't.)

- [ ] **Step 6: End-to-end smoke**

`pnpm dev`. Visit `http://localhost:5173`. Confirm:
- Journals panel shows at order 50, after the four existing panels.
- Three tabs (Daily / Weekly / Monthly), Daily active by default.
- Daily list contains today's entries, sorted with `-3`, `-2`, base prefix order.
- Click a row → chevron flips, body renders with markdown formatting (headings in pink, code blocks padded, lists indented).
- Click another row → previous one collapses, new one expands.
- Switch to Weekly tab → previous expanded entry preserved if you switch back.
- Refresh button refetches the list; bodies stay cached.

- [ ] **Step 7: Commit autofix output (only if the linter changed anything)**

```bash
git status
# only if the linter touched files not yet committed:
git add -A
git commit -m "chore: biome autofix"
```

- [ ] **Step 8: Redeploy the prod daemon**

```bash
scripts/redeploy.sh
```
Expected: web build clean, launchd kickstarted, panel reachable at `http://localhost:7777/`.

---

## Self-review notes

- **Spec coverage check.** Each spec section maps to a task:
  - Architecture (`listJournals` + cache) → Task 1.
  - Body reader + typed errors → Task 2.
  - Panel scaffold + registry wiring → Task 3.
  - API handlers (`GET /` + `GET /:tier/:id` + 4-code error map) → Task 4.
  - UI tabs + row list → Task 5.
  - Accordion + lazy body + markdown render → Task 6.
  - Body polish (tables, blockquote, code wrap) → Task 7.
  - Verification (lint + tests + typecheck + web build + smoke + redeploy) → Task 8.
- **Spec 2 verification gap fixed:** Task 8 explicitly runs `pnpm --filter @cc/web build` (catches the type errors that surfaced post-merge last time).
- **Theme tokens** — only existing vars used (`--pink`, `--cyan`, `--fg`, `--fg-dim`, `--danger`, `--bg-mid`, `--glow-pink`). No new tokens.
- **Per-tier row labels** — daily uses `Session N` (sequence number), weekly/monthly use `N session(s)` (count). Spec ambiguity surfaced during brainstorming and resolved in `rowMeta`.
- **No keyboard navigation** for tabs. Tabs are `<button>` so they tab/Enter activate naturally. Rows are `role="button"` with Enter/Space.
