# Braindump Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "braindump" panel in Control Center: Cmd-Shift-B opens a capture modal; entries land in `~/.claude/braindumps/` as markdown-with-frontmatter files; an hourly in-process job shells out to `claude -p` to categorize/title/summarize/tag each entry; the panel UI shows a Processed tab (default) and an Inbox tab.

**Architecture:** New `panels/braindump/` workspace mirroring `panels/journals/`. Three new server-lib modules (`braindump.ts` for filesystem CRUD, `braindump-prompt.ts` for the LLM prompt + type guard, `braindump-processor.ts` for the state-machine-driven processor) injected with spawner + clock + fs functions for testability. Processor started by `setInterval` in `server/src/main.ts`. Web-side: new `<CaptureModal>` with a `useCaptureModal()` React context and a `useGlobalShortcut()` hook, wired in `web/src/App.tsx`.

**Tech Stack:** Node 22, TypeScript strict, Hono, pnpm workspaces, gray-matter (already a dep via journals), TanStack Query, React 18, Vite, Biome, Vitest, pino. No new npm deps.

**Spec:** `docs/superpowers/specs/2026-04-21-braindump-panel-design.md` (commit `e7b3c30`).

---

## File layout (final state after all tasks)

**New files:**

- `panels/braindump/meta.ts`
- `panels/braindump/types.ts`
- `panels/braindump/api.ts`
- `panels/braindump/api.test.ts`
- `panels/braindump/ui.tsx`
- `panels/braindump/ui.module.css`
- `panels/braindump/package.json`
- `panels/braindump/tsconfig.json`
- `server/src/lib/braindump.ts`
- `server/src/lib/braindump.test.ts`
- `server/src/lib/braindump-prompt.ts`
- `server/src/lib/braindump-prompt.test.ts`
- `server/src/lib/braindump-processor.ts`
- `server/src/lib/braindump-processor.test.ts`
- `web/src/components/CaptureModal.tsx`
- `web/src/components/CaptureModal.module.css`
- `web/src/lib/useCaptureModal.tsx`
- `web/src/lib/useGlobalShortcut.ts`

**Modified files:**

- `web/src/panels.ts` — register braindump.
- `server/src/routes.ts` — mount `/api/braindump`.
- `server/src/main.ts` — start the hourly processor tick + one boot-time tick.
- `web/src/App.tsx` — wrap in `CaptureModalProvider`, register Cmd-Shift-B, render `<CaptureModal>`.
- `pnpm-workspace.yaml` — implicit: `panels/*` pattern already matches.

---

## Task 1: Scaffold panel workspace (empty placeholder that renders)

**Files:**
- Create: `panels/braindump/package.json`
- Create: `panels/braindump/tsconfig.json`
- Create: `panels/braindump/meta.ts`
- Create: `panels/braindump/types.ts`
- Create: `panels/braindump/api.ts`
- Create: `panels/braindump/ui.tsx`
- Create: `panels/braindump/ui.module.css`
- Modify: `web/src/panels.ts`
- Modify: `server/src/routes.ts`

- [ ] **Step 1: Write `panels/braindump/package.json`**

```json
{
  "name": "@cc/panel-braindump",
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
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `panels/braindump/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3: Write `panels/braindump/meta.ts`**

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'braindump',
  title: 'Braindump',
  order: 60,
  defaultSize: 'md',
};
```

- [ ] **Step 4: Write `panels/braindump/types.ts`**

```ts
export type {
  Category,
  EntryStatus,
  EntrySummary,
  ListResponse,
} from '@cc/server/lib/braindump';

export type CaptureRequest = { rawText: string };
export type CaptureResponse = { id: string };
export type BodyResponse = { rawText: string };
```

(The types from `@cc/server/lib/braindump` don't exist yet — that's fine; Task 2 creates them. TypeScript will flag this until Task 2 ships; the scaffolding step's tsconfig has `noEmit: true` so the workspace `pnpm -r test` still passes. If you want a clean commit here, stub the types inline in this file and delete them in Task 2 when the server lib exists. To keep tasks small, let's stub them inline for now.)

Replace the Step 4 content above with this stubbed version (we'll move them to the server lib in Task 2):

```ts
export type Category = 'todo' | 'thought' | 'read-later';
export type EntryStatus = 'new' | 'processing' | 'processed' | 'failed';

export type EntrySummary = {
  id: string;
  capturedAt: string;
  status: EntryStatus;
  category?: Category;
  title?: string;
  summary?: string;
  tags?: string[];
  processedAt?: string;
  failure?: { attempts: number; lastError: string; lastAttemptAt: string };
};

export type ListResponse = {
  inbox: EntrySummary[];
  processed: EntrySummary[];
};

export type CaptureRequest = { rawText: string };
export type CaptureResponse = { id: string };
export type BodyResponse = { rawText: string };
```

- [ ] **Step 5: Write `panels/braindump/api.ts` (placeholder)**

```ts
import { ok } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', (c) => c.json(ok({ inbox: [], processed: [] })));
```

- [ ] **Step 6: Write `panels/braindump/ui.module.css` (minimal placeholder)**

```css
.placeholder {
  color: var(--fg-dim);
  font-style: italic;
  padding: 8px 0;
}
```

- [ ] **Step 7: Write `panels/braindump/ui.tsx` (placeholder that renders a panel)**

```tsx
import s from './ui.module.css';

export const UI = () => {
  return (
    <div className="panel">
      <div className="panel-header">Braindump</div>
      <div className="panel-body">
        <p className={s.placeholder}>Braindump panel coming online…</p>
      </div>
    </div>
  );
};
```

- [ ] **Step 8: Register UI in `web/src/panels.ts`**

Add the import near the other panel imports (keep alphabetical grouping):

```ts
import { meta as braindumpMeta } from '../../panels/braindump/meta';
import { UI as braindumpUI } from '../../panels/braindump/ui';
```

Add the entry to the `panels` array (order doesn't affect sort — `meta.order` does):

```ts
export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
  { meta: prsMeta, UI: prsUI },
  { meta: shortcutsMeta, UI: shortcutsUI },
  { meta: sessionsMeta, UI: sessionsUI },
  { meta: journalsMeta, UI: journalsUI },
  { meta: braindumpMeta, UI: braindumpUI },
];
```

- [ ] **Step 9: Mount API in `server/src/routes.ts`**

Add import:

```ts
import { api as braindumpApi } from '../../panels/braindump/api';
```

Add mount inside `registerRoutes`:

```ts
app.route('/api/braindump', braindumpApi);
```

- [ ] **Step 10: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: success, new panel workspace linked.

- [ ] **Step 11: Run tests to make sure nothing broke**

Run: `pnpm -r test`
Expected: all existing tests still pass; new workspace reports "No tests found — passing" (because of `--passWithNoTests`).

- [ ] **Step 12: Lint check**

Run: `pnpm fix && pnpm check`
Expected: no diff from fix, check passes.

- [ ] **Step 13: Commit**

```bash
git add panels/braindump web/src/panels.ts server/src/routes.ts pnpm-lock.yaml
git commit -m "feat(panels/braindump): scaffold workspace and wire into registries"
```

---

## Task 2: Server lib — filesystem CRUD (`braindump.ts`) + tests

Build the fully-tested filesystem layer. No subprocess concerns. All public functions take an optional `deps` object (mirroring `journals.ts`) so tests never touch the real FS or HOME.

**Files:**
- Create: `server/src/lib/braindump.ts`
- Create: `server/src/lib/braindump.test.ts`

### 2A. Types, errors, helpers, and ID generation

- [ ] **Step 1: Write the failing test for `generateId`**

Add to `server/src/lib/braindump.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

describe('generateId', () => {
  test('produces YYYY-MM-DDTHH-mm-ss-<4char> format using injected clock and suffix', async () => {
    const { generateId } = await import('./braindump');
    const id = generateId({
      now: () => new Date('2026-04-21T14:32:08.412Z'),
      randomSuffix: () => 'a7f3',
    });
    expect(id).toBe('2026-04-21T14-32-08-a7f3');
  });

  test('regex matches the generated id', async () => {
    const { generateId, ID_REGEX } = await import('./braindump');
    const id = generateId({
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      randomSuffix: () => 'z9q0',
    });
    expect(ID_REGEX.test(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: FAIL — cannot resolve `./braindump`.

- [ ] **Step 3: Write minimal `braindump.ts` to make tests pass**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import matter from 'gray-matter';

import { logger } from '../logger';

// ---- Types ------------------------------------------------------------

export type Category = 'todo' | 'thought' | 'read-later';
export type EntryStatus = 'new' | 'processing' | 'processed' | 'failed';

export type FailureInfo = {
  attempts: number;
  lastError: string;
  lastAttemptAt: string;
};

export type EntrySummary = {
  id: string;
  capturedAt: string;
  status: EntryStatus;
  category?: Category;
  title?: string;
  summary?: string;
  tags?: string[];
  processedAt?: string;
  failure?: FailureInfo;
};

export type ListResponse = {
  inbox: EntrySummary[];
  processed: EntrySummary[];
};

export type ProcessedFields = {
  category: Category;
  title: string;
  summary: string;
  tags: string[];
  processedAt: string;
};

// ---- ID generation ----------------------------------------------------

export const ID_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[a-z0-9]{4}$/;

export type IdDeps = {
  now?: () => Date;
  randomSuffix?: () => string;
};

const defaultRandomSuffix = (): string => crypto.randomBytes(2).toString('hex');

export function generateId(deps: IdDeps = {}): string {
  const now = deps.now ?? (() => new Date());
  const randomSuffix = deps.randomSuffix ?? defaultRandomSuffix;
  const d = now();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
  return `${date}T${time}-${randomSuffix()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: PASS (2 tests in `generateId`).

### 2B. `createEntry`

- [ ] **Step 5: Write the failing test for `createEntry`**

Append to `server/src/lib/braindump.test.ts`:

```ts
describe('createEntry', () => {
  type Deps = NonNullable<Parameters<typeof import('./braindump').createEntry>[1]>;

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    return {
      home: '/home/u',
      now: () => new Date('2026-04-21T14:32:08.412Z'),
      randomSuffix: () => 'a7f3',
      mkdir: async () => {},
      writeFile: async () => {},
      ...overrides,
    };
  }

  test('writes <id>.md under ~/.claude/braindumps with status:new + capturedAt + raw body', async () => {
    const { createEntry } = await import('./braindump');
    const writes: Array<{ path: string; data: string }> = [];
    const mkdirs: string[] = [];
    const result = await createEntry('pick up milk', {
      ...makeDeps(),
      mkdir: async (p: string) => {
        mkdirs.push(p);
      },
      writeFile: async (p: string, d: string) => {
        writes.push({ path: p, data: d });
      },
    });
    expect(result.id).toBe('2026-04-21T14-32-08-a7f3');
    expect(mkdirs).toContain('/home/u/.claude/braindumps');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('/home/u/.claude/braindumps/2026-04-21T14-32-08-a7f3.md');
    expect(writes[0]?.data).toContain("id: 2026-04-21T14-32-08-a7f3");
    expect(writes[0]?.data).toContain("capturedAt: '2026-04-21T14:32:08.412Z'");
    expect(writes[0]?.data).toContain('status: new');
    expect(writes[0]?.data).toMatch(/---\npick up milk\n?$/);
  });

  test('rejects empty rawText after trim', async () => {
    const { createEntry } = await import('./braindump');
    await expect(createEntry('   \n\t  ', makeDeps())).rejects.toThrow(/empty/i);
  });

  test('rejects rawText longer than 8000 chars', async () => {
    const { createEntry } = await import('./braindump');
    const tooBig = 'x'.repeat(8001);
    await expect(createEntry(tooBig, makeDeps())).rejects.toThrow(/too long/i);
  });

  test('trims trailing whitespace but preserves internal newlines', async () => {
    const { createEntry } = await import('./braindump');
    let captured = '';
    await createEntry('line 1\n\nline 2\n\n   ', {
      ...makeDeps(),
      writeFile: async (_p: string, d: string) => {
        captured = d;
      },
    });
    expect(captured).toMatch(/---\nline 1\n\nline 2\n?$/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: FAIL — `createEntry is not a function`.

- [ ] **Step 7: Implement `createEntry` in `braindump.ts`**

Append to `server/src/lib/braindump.ts`:

```ts
// ---- createEntry ------------------------------------------------------

export const MAX_RAW_LEN = 8000;

export type CreateDeps = IdDeps & {
  home?: string;
  mkdir?: (p: string) => Promise<void>;
  writeFile?: (p: string, data: string) => Promise<void>;
};

const defaultMkdir = async (p: string): Promise<void> => {
  await fs.promises.mkdir(p, { recursive: true });
};

const defaultWriteFile = async (p: string, data: string): Promise<void> => {
  await fs.promises.writeFile(p, data, 'utf8');
};

function braindumpsDir(home: string): string {
  return path.join(home, '.claude', 'braindumps');
}

function serialize(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, data);
}

export async function createEntry(
  rawText: string,
  deps: CreateDeps = {},
): Promise<{ id: string }> {
  const trimmed = rawText.replace(/\s+$/u, '');
  if (trimmed.trim().length === 0) {
    throw new Error('braindump entry is empty');
  }
  if (trimmed.length > MAX_RAW_LEN) {
    throw new Error(`braindump entry too long (${trimmed.length} > ${MAX_RAW_LEN})`);
  }
  const home = deps.home ?? os.homedir();
  const mkdir = deps.mkdir ?? defaultMkdir;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const now = deps.now ?? (() => new Date());

  const id = generateId({ now, randomSuffix: deps.randomSuffix });
  const dir = braindumpsDir(home);
  await mkdir(dir);
  const file = path.join(dir, `${id}.md`);
  const front = {
    id,
    capturedAt: now().toISOString(),
    status: 'new' as EntryStatus,
  };
  await writeFile(file, serialize(front, trimmed));
  return { id };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: PASS (`generateId` + `createEntry` suites).

### 2C. `listEntries`

- [ ] **Step 9: Write the failing test for `listEntries`**

Append to `braindump.test.ts`:

```ts
describe('listEntries', () => {
  type Deps = NonNullable<Parameters<typeof import('./braindump').listEntries>[0]>;

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    return {
      home: '/home/u',
      readdir: async () => [],
      readFile: async () => '',
      ...overrides,
    };
  }

  test('returns empty lists when braindumps dir is missing (ENOENT)', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    });
    expect(result).toEqual({ inbox: [], processed: [] });
  });

  test('splits entries into inbox vs processed by status', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => [
        '2026-04-21T14-32-08-a7f3.md',
        '2026-04-21T14-00-00-bbbb.md',
      ],
      readFile: async (p: string) => {
        if (p.endsWith('a7f3.md')) {
          return `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
raw text 1`;
        }
        return `---
id: 2026-04-21T14-00-00-bbbb
capturedAt: 2026-04-21T14:00:00.000Z
status: processed
category: todo
title: Buy milk tonight
summary: User wants to remember to pick up milk on the way home.
tags: [home]
processedAt: 2026-04-21T15:00:00.000Z
---
raw text 2`;
      },
    });
    expect(result.inbox).toHaveLength(1);
    expect(result.inbox[0]?.id).toBe('2026-04-21T14-32-08-a7f3');
    expect(result.inbox[0]?.status).toBe('new');
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]?.category).toBe('todo');
    expect(result.processed[0]?.title).toBe('Buy milk tonight');
    expect(result.processed[0]?.tags).toEqual(['home']);
  });

  test('sorts each list newest-first by id (lexicographic)', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => [
        '2026-04-19T10-00-00-aaaa.md',
        '2026-04-21T10-00-00-cccc.md',
        '2026-04-20T10-00-00-bbbb.md',
      ],
      readFile: async (p: string) => {
        const id = path.basename(p, '.md');
        return `---
id: ${id}
capturedAt: 2026-04-20T00:00:00.000Z
status: new
---
x`;
      },
    });
    expect(result.inbox.map((e) => e.id)).toEqual([
      '2026-04-21T10-00-00-cccc',
      '2026-04-20T10-00-00-bbbb',
      '2026-04-19T10-00-00-aaaa',
    ]);
  });

  test('failed entries land in inbox', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['2026-04-21T14-32-08-a7f3.md'],
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: failed
failure:
  attempts: 3
  lastError: claude -p exited with code 1
  lastAttemptAt: 2026-04-21T15:00:02.118Z
---
x`,
    });
    expect(result.inbox).toHaveLength(1);
    expect(result.inbox[0]?.status).toBe('failed');
    expect(result.inbox[0]?.failure?.attempts).toBe(3);
  });

  test('processing entries land in inbox', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['2026-04-21T14-32-08-a7f3.md'],
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: processing
---
x`,
    });
    expect(result.inbox[0]?.status).toBe('processing');
    expect(result.processed).toEqual([]);
  });

  test('skips non-.md files', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['README.txt', '.DS_Store', '2026-04-21T14-32-08-a7f3.md'],
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    expect(result.inbox).toHaveLength(1);
  });

  test('skips entries whose frontmatter fails to parse (and logs warn)', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['bad.md', '2026-04-21T14-32-08-a7f3.md'],
      readFile: async (p: string) => {
        if (p.endsWith('bad.md')) return 'not yaml at all';
        return `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
ok`;
      },
    });
    expect(result.inbox.map((e) => e.id)).toEqual(['2026-04-21T14-32-08-a7f3']);
  });

  test('skips entries whose status is missing or unknown', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['bad-status.md', 'good.md'],
      readFile: async (p: string) => {
        if (p.endsWith('bad-status.md')) {
          return `---
id: bad-status
capturedAt: 2026-04-21T14:32:08.412Z
status: weird
---
x`;
        }
        return `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
ok`;
      },
    });
    expect(result.inbox.map((e) => e.id)).toEqual(['2026-04-21T14-32-08-a7f3']);
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: FAIL — `listEntries is not a function`.

- [ ] **Step 11: Implement `listEntries` in `braindump.ts`**

Append:

```ts
// ---- listEntries ------------------------------------------------------

const STATUS_VALUES: EntryStatus[] = ['new', 'processing', 'processed', 'failed'];
const CATEGORY_VALUES: Category[] = ['todo', 'thought', 'read-later'];

export type ListDeps = {
  home?: string;
  readdir?: (dir: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
};

const defaultReaddir = async (dir: string): Promise<string[]> => {
  return fs.promises.readdir(dir);
};

const defaultReadFile = async (p: string): Promise<string> => fs.promises.readFile(p, 'utf8');

function coerceTags(v: unknown): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  return [];
}

function coerceFailure(v: unknown): FailureInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const obj = v as Record<string, unknown>;
  if (typeof obj.attempts !== 'number') return undefined;
  if (typeof obj.lastError !== 'string') return undefined;
  if (typeof obj.lastAttemptAt !== 'string') return undefined;
  return {
    attempts: obj.attempts,
    lastError: obj.lastError,
    lastAttemptAt: obj.lastAttemptAt,
  };
}

function parseSummary(filename: string, raw: string): EntrySummary | null {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const id = typeof data.id === 'string' ? data.id : path.basename(filename, '.md');
  const capturedAt = typeof data.capturedAt === 'string' ? data.capturedAt : null;
  const status = data.status;
  if (typeof status !== 'string' || !(STATUS_VALUES as string[]).includes(status)) return null;
  if (!capturedAt) return null;
  const summary: EntrySummary = {
    id,
    capturedAt,
    status: status as EntryStatus,
  };
  if (typeof data.category === 'string' && (CATEGORY_VALUES as string[]).includes(data.category)) {
    summary.category = data.category as Category;
  }
  if (typeof data.title === 'string') summary.title = data.title;
  if (typeof data.summary === 'string') summary.summary = data.summary;
  const tags = coerceTags(data.tags);
  if (tags.length > 0) summary.tags = tags;
  if (typeof data.processedAt === 'string') summary.processedAt = data.processedAt;
  const failure = coerceFailure(data.failure);
  if (failure) summary.failure = failure;
  return summary;
}

export async function listEntries(deps: ListDeps = {}): Promise<ListResponse> {
  const home = deps.home ?? os.homedir();
  const readdir = deps.readdir ?? defaultReaddir;
  const readFile = deps.readFile ?? defaultReadFile;
  const dir = braindumpsDir(home);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') return { inbox: [], processed: [] };
    throw err;
  }

  const inbox: EntrySummary[] = [];
  const processed: EntrySummary[] = [];

  for (const name of files) {
    if (!name.endsWith('.md')) continue;
    const filePath = path.join(dir, name);
    let raw: string;
    try {
      raw = await readFile(filePath);
    } catch (err) {
      logger.warn(
        { filePath, err: (err as Error)?.message },
        'braindump read failed; skipping',
      );
      continue;
    }
    let entry: EntrySummary | null;
    try {
      entry = parseSummary(name, raw);
    } catch (err) {
      logger.warn(
        { filePath, err: (err as Error)?.message },
        'braindump parse failed; skipping',
      );
      continue;
    }
    if (!entry) continue;
    if (entry.status === 'processed') processed.push(entry);
    else inbox.push(entry);
  }

  const cmp = (a: EntrySummary, b: EntrySummary) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0);
  inbox.sort(cmp);
  processed.sort(cmp);
  return { inbox, processed };
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: PASS (all suites so far).

### 2D. `readEntryBody`, `readEntry` (full), `deleteEntry`

- [ ] **Step 13: Write failing tests for these three**

Append to `braindump.test.ts`:

```ts
describe('readEntryBody', () => {
  test('returns markdown body, stripping frontmatter', async () => {
    const { readEntryBody } = await import('./braindump');
    const body = await readEntryBody('2026-04-21T14-32-08-a7f3', {
      home: '/home/u',
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
status: new
---
hello\nworld\n`,
    });
    expect(body).toBe('hello\nworld\n');
  });

  test('throws EntryNotFoundError on ENOENT', async () => {
    const { readEntryBody, EntryNotFoundError } = await import('./braindump');
    const deps = {
      home: '/home/u',
      readFile: async () => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    };
    await expect(
      readEntryBody('2026-04-21T14-32-08-a7f3', deps),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  test('throws EntryReadError on other fs errors', async () => {
    const { readEntryBody, EntryReadError } = await import('./braindump');
    const deps = {
      home: '/home/u',
      readFile: async () => {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };
    await expect(
      readEntryBody('2026-04-21T14-32-08-a7f3', deps),
    ).rejects.toBeInstanceOf(EntryReadError);
  });
});

describe('readEntry', () => {
  test('returns both frontmatter summary and raw body', async () => {
    const { readEntry } = await import('./braindump');
    const result = await readEntry('2026-04-21T14-32-08-a7f3', {
      home: '/home/u',
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
body text`,
    });
    expect(result.summary.status).toBe('new');
    expect(result.rawText).toBe('body text');
  });

  test('throws EntryReadError on malformed frontmatter', async () => {
    const { readEntry, EntryReadError } = await import('./braindump');
    await expect(
      readEntry('x', {
        home: '/home/u',
        readFile: async () => 'not yaml',
      }),
    ).rejects.toBeInstanceOf(EntryReadError);
  });
});

describe('deleteEntry', () => {
  test('unlinks the expected file path', async () => {
    const { deleteEntry } = await import('./braindump');
    const unlinked: string[] = [];
    await deleteEntry('2026-04-21T14-32-08-a7f3', {
      home: '/home/u',
      unlink: async (p: string) => {
        unlinked.push(p);
      },
    });
    expect(unlinked).toEqual(['/home/u/.claude/braindumps/2026-04-21T14-32-08-a7f3.md']);
  });

  test('throws EntryNotFoundError when file is missing', async () => {
    const { deleteEntry, EntryNotFoundError } = await import('./braindump');
    await expect(
      deleteEntry('2026-04-21T14-32-08-a7f3', {
        home: '/home/u',
        unlink: async () => {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        },
      }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });
});
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: FAIL — functions/classes missing.

- [ ] **Step 15: Implement the three functions and two error classes**

Append to `braindump.ts`:

```ts
// ---- Errors -----------------------------------------------------------

export class EntryNotFoundError extends Error {
  readonly code = 'ENTRY_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'EntryNotFoundError';
  }
}

export class EntryReadError extends Error {
  readonly code = 'READ_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'EntryReadError';
  }
}

// ---- Read -------------------------------------------------------------

export type ReadDeps = {
  home?: string;
  readFile?: (p: string) => Promise<string>;
};

function entryPath(home: string, id: string): string {
  return path.join(braindumpsDir(home), `${id}.md`);
}

async function loadEntryFile(
  id: string,
  deps: ReadDeps,
): Promise<{ front: Record<string, unknown>; body: string }> {
  const home = deps.home ?? os.homedir();
  const readFile = deps.readFile ?? defaultReadFile;
  let raw: string;
  try {
    raw = await readFile(entryPath(home, id));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') throw new EntryNotFoundError(`braindump not found: ${id}`);
    const msg = err instanceof Error ? err.message : String(err);
    throw new EntryReadError(msg.slice(0, 200));
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EntryReadError(`frontmatter parse failed: ${msg.slice(0, 200)}`);
  }
  return { front: parsed.data as Record<string, unknown>, body: parsed.content };
}

export async function readEntryBody(id: string, deps: ReadDeps = {}): Promise<string> {
  const { body } = await loadEntryFile(id, deps);
  return body;
}

export async function readEntry(
  id: string,
  deps: ReadDeps = {},
): Promise<{ summary: EntrySummary; rawText: string }> {
  const { front, body } = await loadEntryFile(id, deps);
  const summary = parseSummary(`${id}.md`, matter.stringify(body, front));
  if (!summary) throw new EntryReadError(`unrecognized braindump shape for ${id}`);
  return { summary, rawText: body };
}

// ---- Delete -----------------------------------------------------------

export type DeleteDeps = {
  home?: string;
  unlink?: (p: string) => Promise<void>;
};

const defaultUnlink = async (p: string): Promise<void> => fs.promises.unlink(p);

export async function deleteEntry(id: string, deps: DeleteDeps = {}): Promise<void> {
  const home = deps.home ?? os.homedir();
  const unlink = deps.unlink ?? defaultUnlink;
  try {
    await unlink(entryPath(home, id));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') throw new EntryNotFoundError(`braindump not found: ${id}`);
    throw err;
  }
}
```

- [ ] **Step 16: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: PASS.

### 2E. State transitions: `markProcessing`, `markProcessed`, `markFailed`, `reprocessEntry`

- [ ] **Step 17: Write failing tests**

Append:

```ts
describe('markProcessing / markProcessed / markFailed / reprocessEntry', () => {
  const baseFront = `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
raw body`;

  type WriteCall = { path: string; data: string };

  function withWrites() {
    const writes: WriteCall[] = [];
    const writeFile = async (p: string, d: string) => {
      writes.push({ path: p, data: d });
    };
    return { writes, writeFile };
  }

  test('markProcessing rewrites file with status:processing and preserves raw body', async () => {
    const { markEntryProcessing } = await import('./braindump');
    const { writes, writeFile } = withWrites();
    await markEntryProcessing('2026-04-21T14-32-08-a7f3', {
      home: '/home/u',
      readFile: async () => baseFront,
      writeFile,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toContain('status: processing');
    expect(writes[0]?.data).toMatch(/---\nraw body$/);
  });

  test('markProcessed sets status:processed + all processed fields', async () => {
    const { markEntryProcessed } = await import('./braindump');
    const { writes, writeFile } = withWrites();
    await markEntryProcessed(
      '2026-04-21T14-32-08-a7f3',
      {
        category: 'todo',
        title: 'Buy milk tonight',
        summary: 'Pick up milk on the way home.',
        tags: ['home'],
        processedAt: '2026-04-21T15:00:00.000Z',
      },
      {
        home: '/home/u',
        readFile: async () =>
          baseFront.replace('status: new', 'status: processing'),
        writeFile,
      },
    );
    const data = writes[0]?.data ?? '';
    expect(data).toContain('status: processed');
    expect(data).toContain('category: todo');
    expect(data).toContain('title: Buy milk tonight');
    expect(data).toContain('summary: Pick up milk on the way home.');
    expect(data).toContain('processedAt: ');
    expect(data).toContain('tags:');
    expect(data).toMatch(/---\nraw body$/);
  });

  test('markProcessed clears a pre-existing failure block', async () => {
    const { markEntryProcessed } = await import('./braindump');
    const { writes, writeFile } = withWrites();
    const withFailure = `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: processing
failure:
  attempts: 1
  lastError: boom
  lastAttemptAt: 2026-04-21T14:59:00.000Z
---
raw body`;
    await markEntryProcessed(
      '2026-04-21T14-32-08-a7f3',
      {
        category: 'thought',
        title: 't',
        summary: 's',
        tags: [],
        processedAt: '2026-04-21T15:00:00.000Z',
      },
      {
        home: '/home/u',
        readFile: async () => withFailure,
        writeFile,
      },
    );
    expect(writes[0]?.data).not.toContain('failure:');
  });

  test('markFailed increments attempts and flips to failed at attempts===3', async () => {
    const { markEntryFailed } = await import('./braindump');

    // Attempt 1: status back to 'new', attempts=1
    {
      const { writes, writeFile } = withWrites();
      await markEntryFailed(
        '2026-04-21T14-32-08-a7f3',
        { error: 'timeout', at: '2026-04-21T15:00:00.000Z' },
        {
          home: '/home/u',
          readFile: async () =>
            baseFront.replace('status: new', 'status: processing'),
          writeFile,
        },
      );
      expect(writes[0]?.data).toContain('status: new');
      expect(writes[0]?.data).toContain('attempts: 1');
    }

    // Attempt 3: terminal failed
    {
      const { writes, writeFile } = withWrites();
      const preFail = `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: processing
failure:
  attempts: 2
  lastError: prev
  lastAttemptAt: 2026-04-21T14:59:00.000Z
---
raw body`;
      await markEntryFailed(
        '2026-04-21T14-32-08-a7f3',
        { error: 'nope', at: '2026-04-21T15:00:00.000Z' },
        {
          home: '/home/u',
          readFile: async () => preFail,
          writeFile,
        },
      );
      expect(writes[0]?.data).toContain('status: failed');
      expect(writes[0]?.data).toContain('attempts: 3');
    }
  });

  test('reprocessEntry sets status back to new and clears failure block', async () => {
    const { reprocessEntry } = await import('./braindump');
    const { writes, writeFile } = withWrites();
    const terminal = `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: failed
category: thought
title: t
summary: s
processedAt: 2026-04-21T15:00:00.000Z
failure:
  attempts: 3
  lastError: boom
  lastAttemptAt: 2026-04-21T14:59:00.000Z
---
raw body`;
    await reprocessEntry('2026-04-21T14-32-08-a7f3', {
      home: '/home/u',
      readFile: async () => terminal,
      writeFile,
    });
    const data = writes[0]?.data ?? '';
    expect(data).toContain('status: new');
    expect(data).not.toContain('failure:');
    // Processed fields remain (user can see prior classification); they'll be overwritten on next process.
    expect(data).toContain('category: thought');
  });
});
```

- [ ] **Step 18: Run tests to verify they fail**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: FAIL — mark/reprocess functions missing.

- [ ] **Step 19: Implement the state-transition functions**

Append to `braindump.ts`:

```ts
// ---- State transitions ------------------------------------------------

export type WriteDeps = ReadDeps & {
  writeFile?: (p: string, data: string) => Promise<void>;
};

async function rewriteFront(
  id: string,
  transform: (front: Record<string, unknown>) => Record<string, unknown>,
  deps: WriteDeps,
): Promise<void> {
  const home = deps.home ?? os.homedir();
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const { front, body } = await loadEntryFile(id, deps);
  const next = transform(front);
  await writeFile(entryPath(home, id), serialize(next, body));
}

export async function markEntryProcessing(id: string, deps: WriteDeps = {}): Promise<void> {
  await rewriteFront(
    id,
    (front) => ({ ...front, status: 'processing' }),
    deps,
  );
}

export async function markEntryProcessed(
  id: string,
  fields: ProcessedFields,
  deps: WriteDeps = {},
): Promise<void> {
  await rewriteFront(
    id,
    (front) => {
      const { failure: _dropFailure, ...rest } = front;
      return {
        ...rest,
        status: 'processed',
        category: fields.category,
        title: fields.title,
        summary: fields.summary,
        tags: fields.tags,
        processedAt: fields.processedAt,
      };
    },
    deps,
  );
}

export type FailureUpdate = { error: string; at: string };

export async function markEntryFailed(
  id: string,
  update: FailureUpdate,
  deps: WriteDeps = {},
): Promise<void> {
  await rewriteFront(
    id,
    (front) => {
      const prev = coerceFailure(front.failure);
      const attempts = (prev?.attempts ?? 0) + 1;
      const nextStatus: EntryStatus = attempts >= 3 ? 'failed' : 'new';
      return {
        ...front,
        status: nextStatus,
        failure: {
          attempts,
          lastError: update.error.slice(0, 500),
          lastAttemptAt: update.at,
        },
      };
    },
    deps,
  );
}

export async function reprocessEntry(id: string, deps: WriteDeps = {}): Promise<void> {
  await rewriteFront(
    id,
    (front) => {
      const { failure: _dropFailure, ...rest } = front;
      return { ...rest, status: 'new' };
    },
    deps,
  );
}
```

- [ ] **Step 20: Run tests to verify all pass**

Run: `pnpm --filter @cc/server test -- braindump`
Expected: PASS (all suites).

### 2F. Delete the stubbed types from `panels/braindump/types.ts`

- [ ] **Step 21: Re-export server types from `panels/braindump/types.ts`**

Replace the file contents:

```ts
export type {
  Category,
  EntryStatus,
  EntrySummary,
  FailureInfo,
  ListResponse,
  ProcessedFields,
} from '@cc/server/lib/braindump';

export type CaptureRequest = { rawText: string };
export type CaptureResponse = { id: string };
export type BodyResponse = { rawText: string };
```

- [ ] **Step 22: Run full workspace test + lint**

```bash
pnpm -r test
pnpm fix && pnpm check
```

Expected: all pass.

- [ ] **Step 23: Commit**

```bash
git add server/src/lib/braindump.ts server/src/lib/braindump.test.ts panels/braindump/types.ts
git commit -m "feat(server): braindump CRUD lib with injected-deps test coverage"
```

---

## Task 3: Server lib — prompt + type guard (`braindump-prompt.ts`)

**Files:**
- Create: `server/src/lib/braindump-prompt.ts`
- Create: `server/src/lib/braindump-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/src/lib/braindump-prompt.test.ts
import { describe, expect, test } from 'vitest';

describe('isValidLlmOutput', () => {
  test('accepts valid todo with tags', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 'Buy milk tonight',
        summary: 'Pick up milk on the way home from work.',
        tags: ['home', 'urgency:today'],
      }),
    ).toBe(true);
  });

  test('accepts valid thought with empty tags', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'thought',
        title: 'Refactor idea',
        summary: 'Could split the processor into two files.',
        tags: [],
      }),
    ).toBe(true);
  });

  test('accepts valid read-later', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'read-later',
        title: 'Paper on data oriented design',
        summary: 'An article about structuring systems by data access patterns.',
        tags: ['reading'],
      }),
    ).toBe(true);
  });

  test('rejects missing field', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(isValidLlmOutput({ category: 'todo', title: 't', summary: 's' })).toBe(false);
  });

  test('rejects wrong category', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'reminder',
        title: 't',
        summary: 's',
        tags: [],
      }),
    ).toBe(false);
  });

  test('rejects non-string title', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 42,
        summary: 's',
        tags: [],
      }),
    ).toBe(false);
  });

  test('rejects non-array tags', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 't',
        summary: 's',
        tags: 'home',
      }),
    ).toBe(false);
  });

  test('rejects non-string tag element', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 't',
        summary: 's',
        tags: ['home', 42],
      }),
    ).toBe(false);
  });

  test('rejects null / non-object', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(isValidLlmOutput(null)).toBe(false);
    expect(isValidLlmOutput('nope')).toBe(false);
    expect(isValidLlmOutput(undefined)).toBe(false);
  });
});

describe('PROMPT', () => {
  test('mentions the three categories and the JSON rule', async () => {
    const { PROMPT } = await import('./braindump-prompt');
    expect(PROMPT).toContain('todo');
    expect(PROMPT).toContain('thought');
    expect(PROMPT).toContain('read-later');
    expect(PROMPT.toLowerCase()).toContain('json');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cc/server test -- braindump-prompt`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `braindump-prompt.ts`**

```ts
// server/src/lib/braindump-prompt.ts
import type { Category } from './braindump';

export type LlmOutput = {
  category: Category;
  title: string;
  summary: string;
  tags: string[];
};

const CATEGORIES: readonly Category[] = ['todo', 'thought', 'read-later'];

export function isValidLlmOutput(x: unknown): x is LlmOutput {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.category !== 'string' || !(CATEGORIES as readonly string[]).includes(o.category))
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test -- braindump-prompt`
Expected: PASS.

- [ ] **Step 5: Lint + full test**

```bash
pnpm fix && pnpm check && pnpm -r test
```

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/braindump-prompt.ts server/src/lib/braindump-prompt.test.ts
git commit -m "feat(server): braindump-prompt with LLM output type guard"
```

---

## Task 4: Server lib — processor (`braindump-processor.ts`) + tests

This is the state-machine driver. Injects a high-level `runClaude` so tests never spawn real subprocesses.

**Files:**
- Create: `server/src/lib/braindump-processor.ts`
- Create: `server/src/lib/braindump-processor.test.ts`

### 4A. `runClaude` abstraction + default implementation

- [ ] **Step 1: Write failing test — happy path (new → processed)**

```ts
// server/src/lib/braindump-processor.test.ts
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Each test isolates module state by reset + dynamic import.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFakeFs(entries: Record<string, string>) {
  const writes: Array<{ path: string; data: string }> = [];
  return {
    writes,
    home: '/home/u',
    async readdir(_dir: string) {
      return Object.keys(entries).map((id) => `${id}.md`);
    },
    async readFile(p: string) {
      const id = path.basename(p, '.md');
      if (entries[id] === undefined) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return entries[id] as string;
    },
    async writeFile(p: string, data: string) {
      writes.push({ path: p, data });
      const id = path.basename(p, '.md');
      entries[id] = data;
    },
  };
}

describe('processPending — happy path', () => {
  test('processes a new entry to processed with all fields populated', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      'a7f3': `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
buy milk tonight`,
    });

    const runClaude = vi.fn(async () =>
      JSON.stringify({
        category: 'todo',
        title: 'Buy milk tonight',
        summary: 'Reminder to pick up milk on the way home.',
        tags: ['home'],
      }),
    );

    const result = await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });

    expect(runClaude).toHaveBeenCalledOnce();
    expect(result).toEqual({ processed: 1, failed: 0, skipped: 0 });
    const finalRaw = fs.writes.at(-1)?.data ?? '';
    expect(finalRaw).toContain('status: processed');
    expect(finalRaw).toContain('category: todo');
    expect(finalRaw).toContain('title: Buy milk tonight');
    expect(finalRaw).toContain('tags:');
    expect(finalRaw).toContain('processedAt: ');
    // Two writes: status:processing, then status:processed.
    expect(fs.writes.filter((w) => w.data.includes('status: processing'))).toHaveLength(1);
  });

  test('only scans status: new (skips processed, failed, processing)', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      'already-processed': `---
id: already-processed
capturedAt: 2026-04-21T13:00:00.000Z
status: processed
category: thought
title: t
summary: s
processedAt: 2026-04-21T14:00:00.000Z
---
x`,
      'in-flight': `---
id: in-flight
capturedAt: 2026-04-21T13:00:00.000Z
status: processing
---
x`,
      'terminal-failed': `---
id: terminal-failed
capturedAt: 2026-04-21T13:00:00.000Z
status: failed
failure:
  attempts: 3
  lastError: boom
  lastAttemptAt: 2026-04-21T14:00:00.000Z
---
x`,
    });
    const runClaude = vi.fn();
    const result = await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });
    expect(runClaude).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, failed: 0, skipped: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cc/server test -- braindump-processor`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement minimal `braindump-processor.ts` to pass happy path + skip test**

```ts
// server/src/lib/braindump-processor.ts
import { spawn } from 'node:child_process';

import { logger } from '../logger';
import {
  type EntrySummary,
  type WriteDeps,
  type ListDeps,
  listEntries,
  markEntryFailed,
  markEntryProcessed,
  markEntryProcessing,
  readEntry,
} from './braindump';
import { PROMPT, isValidLlmOutput } from './braindump-prompt';

export type RunClaudeArgs = {
  prompt: string;
  input: string;
  timeoutMs: number;
};

export type RunClaude = (args: RunClaudeArgs) => Promise<string>;

export type ProcessDeps = ListDeps &
  WriteDeps & {
    runClaude?: RunClaude;
    now?: () => Date;
    timeoutMs?: number;
  };

export type ProcessResult = {
  processed: number;
  failed: number;
  skipped: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

let isProcessing = false;

export function _resetForTests(): void {
  isProcessing = false;
}

export async function processPending(deps: ProcessDeps = {}): Promise<ProcessResult> {
  if (isProcessing) {
    logger.debug('braindump processor tick skipped (reentrancy)');
    return { processed: 0, failed: 0, skipped: 0 };
  }
  isProcessing = true;
  try {
    const { inbox } = await listEntries(deps);
    const pending = inbox.filter((e) => e.status === 'new');
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const runClaude = deps.runClaude ?? defaultRunClaude;
    const now = deps.now ?? (() => new Date());
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (const entry of pending) {
      const outcome = await processOne(entry, { ...deps, runClaude, now, timeoutMs });
      if (outcome === 'processed') processed++;
      else if (outcome === 'failed') failed++;
      else skipped++;
    }

    logger.info({ processed, failed, skipped }, 'braindump processor tick');
    return { processed, failed, skipped };
  } finally {
    isProcessing = false;
  }
}

async function processOne(
  entry: EntrySummary,
  deps: ProcessDeps & { runClaude: RunClaude; now: () => Date; timeoutMs: number },
): Promise<'processed' | 'failed' | 'skipped'> {
  const id = entry.id;
  try {
    await markEntryProcessing(id, deps);
    const full = await readEntry(id, deps);
    const raw = await deps.runClaude({
      prompt: PROMPT,
      input: full.rawText,
      timeoutMs: deps.timeoutMs,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`claude output was not JSON: ${(err as Error).message}`);
    }
    if (!isValidLlmOutput(parsed)) {
      throw new Error('claude output did not match expected schema');
    }
    await markEntryProcessed(
      id,
      {
        category: parsed.category,
        title: parsed.title,
        summary: parsed.summary,
        tags: parsed.tags,
        processedAt: deps.now().toISOString(),
      },
      deps,
    );
    return 'processed';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ id, err: msg }, 'braindump process failed');
    try {
      await markEntryFailed(id, { error: msg, at: deps.now().toISOString() }, deps);
      return 'failed';
    } catch (err2) {
      logger.error(
        { id, err: (err2 as Error).message },
        'braindump process failure bookkeeping failed',
      );
      return 'skipped';
    }
  }
}

// ---- Default runClaude (spawns `claude -p`) ---------------------------

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

    child.stdin.end(`${prompt}${input}\n`);
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cc/server test -- braindump-processor`
Expected: PASS (happy path + skip test).

### 4B. Failure paths

- [ ] **Step 5: Write failing tests for failures + retries**

Append to `braindump-processor.test.ts`:

```ts
describe('processPending — failures', () => {
  test('invalid JSON output → failed bookkeeping, attempts=1, status:new', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      'a7f3': `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    const runClaude = vi.fn(async () => 'not-json');
    const result = await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });
    expect(result).toEqual({ processed: 0, failed: 1, skipped: 0 });
    const final = fs.writes.at(-1)?.data ?? '';
    expect(final).toContain('status: new');
    expect(final).toContain('attempts: 1');
    expect(final.toLowerCase()).toContain('not json');
  });

  test('schema-mismatch output → failed', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      'a7f3': `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    const runClaude = vi.fn(async () =>
      JSON.stringify({ category: 'reminder', title: 't', summary: 's', tags: [] }),
    );
    const result = await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });
    expect(result.failed).toBe(1);
  });

  test('3rd attempt flips to terminal failed', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      'a7f3': `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
failure:
  attempts: 2
  lastError: prev
  lastAttemptAt: 2026-04-21T14:00:00.000Z
---
x`,
    });
    const runClaude = vi.fn(async () => 'still-not-json');
    await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });
    const final = fs.writes.at(-1)?.data ?? '';
    expect(final).toContain('status: failed');
    expect(final).toContain('attempts: 3');
  });

  test('runClaude rejects (subprocess error) → failed bookkeeping', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      'a7f3': `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    const runClaude = vi.fn(async () => {
      throw new Error('ENOENT: claude not installed');
    });
    const result = await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });
    expect(result.failed).toBe(1);
    const final = fs.writes.at(-1)?.data ?? '';
    expect(final).toContain('ENOENT');
  });
});

describe('processPending — reentrancy', () => {
  test('concurrent calls: second one no-ops while first is running', async () => {
    const { processPending, _resetForTests } = await import('./braindump-processor');
    _resetForTests();
    const fs = makeFakeFs({
      'a7f3': `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    let resolveFirst!: (v: string) => void;
    const firstClaude = new Promise<string>((r) => {
      resolveFirst = r;
    });
    const runClaude = vi
      .fn()
      .mockImplementationOnce(async () => firstClaude)
      .mockImplementationOnce(async () =>
        JSON.stringify({ category: 'thought', title: 't', summary: 's', tags: [] }),
      );

    const p1 = processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });

    // Second call while first is pending — must no-op.
    const r2 = await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });
    expect(r2).toEqual({ processed: 0, failed: 0, skipped: 0 });
    expect(runClaude).toHaveBeenCalledTimes(1);

    resolveFirst(
      JSON.stringify({ category: 'thought', title: 't', summary: 's', tags: [] }),
    );
    await p1;
  });
});
```

- [ ] **Step 6: Run tests to verify they fail / pass as applicable**

Run: `pnpm --filter @cc/server test -- braindump-processor`
Expected: all new tests PASS (the earlier impl already handles the failure paths via `markEntryFailed`, and the reentrancy guard is already in place). If any test fails, fix the implementation until all pass.

- [ ] **Step 7: Lint + full test**

```bash
pnpm fix && pnpm check && pnpm -r test
```

- [ ] **Step 8: Commit**

```bash
git add server/src/lib/braindump-processor.ts server/src/lib/braindump-processor.test.ts
git commit -m "feat(server): braindump processor with state-machine driven retries"
```

---

## Task 5: API routes (`panels/braindump/api.ts`) + tests

**Files:**
- Modify: `panels/braindump/api.ts`
- Create: `panels/braindump/api.test.ts`

- [ ] **Step 1: Write failing tests for all endpoints**

```ts
// panels/braindump/api.test.ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/braindump', () => ({
  ID_REGEX: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[a-z0-9]{4}$/,
  createEntry: vi.fn(async (_raw: string) => ({ id: '2026-04-21T14-32-08-a7f3' })),
  listEntries: vi.fn(async () => ({ inbox: [], processed: [] })),
  readEntryBody: vi.fn(async () => 'raw text'),
  deleteEntry: vi.fn(async () => undefined),
  reprocessEntry: vi.fn(async () => undefined),
  EntryNotFoundError: class EntryNotFoundError extends Error {
    code = 'ENTRY_NOT_FOUND';
  },
  EntryReadError: class EntryReadError extends Error {
    code = 'READ_FAILED';
  },
}));

vi.mock('@cc/server/lib/braindump-processor', () => ({
  processPending: vi.fn(async () => ({ processed: 0, failed: 0, skipped: 0 })),
}));

const VALID_ID = '2026-04-21T14-32-08-a7f3';

describe('braindump api', () => {
  test('POST / creates an entry and returns { id }', async () => {
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: 'pick up milk' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { id: VALID_ID } });
  });

  test('POST / with empty body returns 400 BAD_REQUEST', async () => {
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('POST / with missing rawText returns 400 BAD_REQUEST', async () => {
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('GET / returns { inbox, processed } envelope', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ inbox: [], processed: [] });
  });

  test('GET /:id returns rawText on success', async () => {
    const { api } = await import('./api');
    const res = await api.request(`/${VALID_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { rawText: 'raw text' } });
  });

  test('GET /:id rejects invalid id format', async () => {
    const { api } = await import('./api');
    const res = await api.request('/bogus');
    expect(res.status).toBe(400);
  });

  test('GET /:id returns 404 when not found', async () => {
    const svc = await import('@cc/server/lib/braindump');
    const NotFound = svc.EntryNotFoundError as new (m: string) => Error;
    (svc.readEntryBody as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NotFound('missing'),
    );
    const { api } = await import('./api');
    const res = await api.request(`/${VALID_ID}`);
    expect(res.status).toBe(404);
  });

  test('DELETE /:id unlinks and returns ok', async () => {
    const { api } = await import('./api');
    const res = await api.request(`/${VALID_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('DELETE /:id rejects invalid id format', async () => {
    const { api } = await import('./api');
    const res = await api.request('/bogus', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  test('POST /:id/reprocess flips to status:new and returns ok', async () => {
    const { api } = await import('./api');
    const res = await api.request(`/${VALID_ID}/reprocess`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  test('POST /:id/reprocess rejects invalid id', async () => {
    const { api } = await import('./api');
    const res = await api.request('/bogus/reprocess', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /process triggers processPending and returns its result', async () => {
    const { api } = await import('./api');
    const res = await api.request('/process', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { processed: 0, failed: 0, skipped: 0 },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cc/panel-braindump test`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Implement `panels/braindump/api.ts`**

Replace the placeholder with the full version:

```ts
import { fail, ok } from '@cc/server/envelope';
import {
  EntryNotFoundError,
  EntryReadError,
  ID_REGEX,
  createEntry,
  deleteEntry,
  listEntries,
  readEntryBody,
  reprocessEntry,
} from '@cc/server/lib/braindump';
import { processPending } from '@cc/server/lib/braindump-processor';
import { Hono } from 'hono';

export const api = new Hono();

api.post('/', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(fail('BAD_REQUEST', 'invalid JSON'), 400);
  }
  if (!payload || typeof payload !== 'object') {
    return c.json(fail('BAD_REQUEST', 'body must be a JSON object'), 400);
  }
  const rawText = (payload as { rawText?: unknown }).rawText;
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return c.json(fail('BAD_REQUEST', 'rawText is required'), 400);
  }
  try {
    const { id } = await createEntry(rawText);
    return c.json(ok({ id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/too long/i.test(msg)) return c.json(fail('BAD_REQUEST', msg), 400);
    if (/empty/i.test(msg)) return c.json(fail('BAD_REQUEST', msg), 400);
    return c.json(fail('WRITE_FAILED', msg), 500);
  }
});

api.get('/', async (c) => {
  const data = await listEntries();
  return c.json(ok(data));
});

api.post('/process', async (c) => {
  const data = await processPending();
  return c.json(ok(data));
});

api.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  try {
    const rawText = await readEntryBody(id);
    return c.json(ok({ rawText }));
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    if (err instanceof EntryReadError) {
      return c.json(fail(err.code, err.message), 500);
    }
    throw err;
  }
});

api.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  try {
    await deleteEntry(id);
    return c.json(ok({ deleted: true }));
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    throw err;
  }
});

api.post('/:id/reprocess', async (c) => {
  const id = c.req.param('id');
  if (!ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  try {
    await reprocessEntry(id);
    return c.json(ok({ reprocessing: true }));
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    throw err;
  }
});
```

Note: the `/process` route is declared **before** the `/:id` routes so it's matched literally. If the order is reversed Hono will match `process` as an `id` and the regex guard will fail with 400.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cc/panel-braindump test`
Expected: PASS.

- [ ] **Step 5: Lint + full workspace test**

```bash
pnpm fix && pnpm check && pnpm -r test
```

- [ ] **Step 6: Commit**

```bash
git add panels/braindump/api.ts panels/braindump/api.test.ts
git commit -m "feat(panels/braindump): HTTP routes with envelope + id regex guard"
```

---

## Task 6: Wire the hourly processor tick in `server/src/main.ts`

No tests — this is runtime wiring. A manual smoke test is in Task 11.

**Files:**
- Modify: `server/src/main.ts`

- [ ] **Step 1: Add processor import and startup**

Add to `server/src/main.ts` just below the existing `registerRoutes(app);` line:

```ts
import { processPending } from './lib/braindump-processor';

// Braindump: kick one pass on boot, then hourly. setInterval runs only while
// the daemon is up; launchd's KeepAlive already handles crash recovery.
const ONE_HOUR_MS = 60 * 60 * 1000;
void processPending().catch((err) =>
  logger.warn({ err: (err as Error).message }, 'braindump boot tick failed'),
);
setInterval(() => {
  void processPending().catch((err) =>
    logger.warn({ err: (err as Error).message }, 'braindump hourly tick failed'),
  );
}, ONE_HOUR_MS);
```

Place the `import` with the other imports at the top of the file, and the `setInterval` block after `registerRoutes(app)` but before the static-file section. The final file order should be: imports → pricing bootstrap → `startedAtMs/app` setup → `/api/health` → `registerRoutes` → braindump processor startup → static serving → onError → serve.

- [ ] **Step 2: Typecheck + test**

```bash
pnpm fix && pnpm check && pnpm -r test
```

Expected: all green.

- [ ] **Step 3: Manual smoke — start dev and verify the log line fires**

Run: `pnpm dev` in a separate terminal (leave it running while you look).
Expected: within a second of boot, `braindump processor tick` log line (level `info`) appears with `processed=0 failed=0 skipped=0`. Stop the dev server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add server/src/main.ts
git commit -m "feat(server): start braindump processor on boot + hourly tick"
```

---

## Task 7: Web — `useGlobalShortcut` + `useCaptureModal` context

**Files:**
- Create: `web/src/lib/useGlobalShortcut.ts`
- Create: `web/src/lib/useCaptureModal.tsx`

- [ ] **Step 1: Write `web/src/lib/useGlobalShortcut.ts`**

```ts
import { useEffect } from 'react';

export type Shortcut = {
  key: string; // e.g. 'B' (compared case-insensitively)
  meta?: boolean; // Cmd on mac, Win on windows
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
};

function matches(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if ((s.meta ?? false) !== e.metaKey) return false;
  if ((s.shift ?? false) !== e.shiftKey) return false;
  if ((s.alt ?? false) !== e.altKey) return false;
  if ((s.ctrl ?? false) !== e.ctrlKey) return false;
  return true;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcut(shortcut: Shortcut, handler: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matches(e, shortcut)) return;
      // Cmd-Shift-B intentionally works even inside inputs — user wants to dump a thought from anywhere.
      if (isEditableTarget(e.target) && !shortcut.meta) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut, handler]);
}
```

- [ ] **Step 2: Write `web/src/lib/useCaptureModal.tsx`**

```tsx
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

type Ctx = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const CaptureModalContext = createContext<Ctx | null>(null);

export function CaptureModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <CaptureModalContext.Provider value={value}>{children}</CaptureModalContext.Provider>;
}

export function useCaptureModal(): Ctx {
  const ctx = useContext(CaptureModalContext);
  if (!ctx) throw new Error('useCaptureModal must be used inside <CaptureModalProvider>');
  return ctx;
}
```

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm fix && pnpm check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/useGlobalShortcut.ts web/src/lib/useCaptureModal.tsx
git commit -m "feat(web): useGlobalShortcut hook + useCaptureModal context"
```

---

## Task 8: Web — `<CaptureModal>` component

**Files:**
- Create: `web/src/components/CaptureModal.tsx`
- Create: `web/src/components/CaptureModal.module.css`

- [ ] **Step 1: Write `web/src/components/CaptureModal.module.css`**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 100;
}
.card {
  background: var(--bg-mid);
  border: 1px solid var(--pink);
  box-shadow: 0 0 20px rgba(255, 64, 200, 0.25);
  border-radius: 4px;
  width: min(640px, 92vw);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.title {
  color: var(--pink);
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-size: 13px;
  text-shadow: var(--glow-pink);
}
.textarea {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--fg-dim);
  border-radius: 3px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 8px 10px;
  min-height: 120px;
  max-height: 440px;
  resize: none;
  outline: none;
}
.textarea:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 6px rgba(0, 240, 255, 0.25);
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.buttons {
  display: flex;
  gap: 8px;
}
.btn {
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--fg-dim);
  padding: 6px 12px;
  font: inherit;
  font-size: 12px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.btnPrimary {
  border-color: var(--pink);
  color: var(--pink);
}
.btnPrimary:hover {
  background: rgba(255, 64, 200, 0.12);
}
.btn:hover {
  border-color: var(--fg);
}
.counter {
  color: var(--fg-dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.counterWarn {
  color: var(--danger);
}
.error {
  color: var(--danger);
  font-size: 12px;
}
```

- [ ] **Step 2: Write `web/src/components/CaptureModal.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../lib/fetchJson';
import { useCaptureModal } from '../lib/useCaptureModal';
import s from './CaptureModal.module.css';

const MAX = 8000;

export function CaptureModal() {
  const { isOpen, close } = useCaptureModal();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: async (rawText: string) =>
      fetchJson<{ id: string }>('/api/braindump', {
        method: 'POST',
        body: JSON.stringify({ rawText }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['braindump'] });
      setText('');
      setError(null);
      close();
    },
    onError: (err) => {
      setError((err as Error).message);
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setText('');
    const t = setTimeout(() => textareaRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError('Empty entry');
      return;
    }
    if (text.length > MAX) {
      setError(`Too long (${text.length} / ${MAX})`);
      return;
    }
    save.mutate(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const counterClass =
    text.length > MAX * 0.9 ? `${s.counter} ${s.counterWarn}` : s.counter;

  return (
    <div
      className={s.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={s.card} role="dialog" aria-modal="true" aria-label="Braindump">
        <div className={s.title}>Braindump</div>
        <textarea
          ref={textareaRef}
          className={s.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="dump a thought, a TODO, or something to read later…"
          rows={6}
        />
        {error && <div className={s.error}>{error}</div>}
        <div className={s.footer}>
          <span className={counterClass}>
            {text.length} / {MAX}
          </span>
          <div className={s.buttons}>
            <button type="button" className={s.btn} onClick={close}>
              Cancel (Esc)
            </button>
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={submit}
              disabled={save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save (⌘↵)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm fix && pnpm check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/CaptureModal.tsx web/src/components/CaptureModal.module.css
git commit -m "feat(web): CaptureModal with Cmd-Enter save, Esc cancel, 8000 char cap"
```

---

## Task 9: Wire App.tsx — provider, shortcut, render modal

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Update `web/src/App.tsx`**

Final contents:

```tsx
import type { PanelSize } from '@cc/shared';
import { CaptureModal } from './components/CaptureModal';
import { ErrorBoundary } from './lib/ErrorBoundary';
import { CaptureModalProvider, useCaptureModal } from './lib/useCaptureModal';
import { useGlobalShortcut } from './lib/useGlobalShortcut';
import { panels } from './panels';

const SPAN: Record<PanelSize, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

function AppShell() {
  const { open } = useCaptureModal();
  useGlobalShortcut({ key: 'b', meta: true, shift: true }, open);

  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  const topBar = sorted.filter(({ meta }) => meta.placement === 'top-bar');
  const grid = sorted.filter(({ meta }) => meta.placement !== 'top-bar');

  return (
    <main className="app">
      {topBar.length > 0 && (
        <div className="top-bar">
          {topBar.map(({ meta, UI }) => (
            <ErrorBoundary key={meta.id} panelId={meta.id}>
              <UI />
            </ErrorBoundary>
          ))}
        </div>
      )}
      <header className="app-header">
        <h1 className="app-title">CONTROL CENTER</h1>
      </header>
      <section className="panel-grid">
        {grid.length === 0 ? (
          <div className="empty">No panels registered yet.</div>
        ) : (
          grid.map(({ meta, UI }) => (
            <div
              key={meta.id}
              className="panel-slot"
              style={{ gridColumn: SPAN[meta.defaultSize] }}
            >
              <ErrorBoundary panelId={meta.id}>
                <UI />
              </ErrorBoundary>
            </div>
          ))
        )}
      </section>
      <CaptureModal />
    </main>
  );
}

export function App() {
  return (
    <CaptureModalProvider>
      <AppShell />
    </CaptureModalProvider>
  );
}
```

- [ ] **Step 2: Lint + typecheck**

```bash
pnpm fix && pnpm check
```

Expected: clean.

- [ ] **Step 3: Manual smoke**

Run: `pnpm dev`
Open http://localhost:5173 in a browser.
Expected:
1. Panel "Braindump" appears as a placeholder tile.
2. Press Cmd-Shift-B anywhere on the page → modal opens, textarea focused.
3. Type "test entry", Cmd-Enter → modal closes, the backend writes `~/.claude/braindumps/<id>.md`.
4. Verify the file exists: `ls ~/.claude/braindumps/`.
5. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): wire Cmd-Shift-B shortcut + CaptureModal at app shell"
```

---

## Task 10: Panel UI — tabs, Processed, Inbox, rows, body

**Files:**
- Modify: `panels/braindump/ui.tsx`
- Modify: `panels/braindump/ui.module.css`

- [ ] **Step 1: Replace `panels/braindump/ui.module.css`**

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
.tab:hover { color: var(--fg); }
.tabActive {
  color: var(--pink);
  border-bottom-color: var(--pink);
  text-shadow: var(--glow-pink);
}
.tabBadge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  background: var(--pink);
  color: var(--bg);
  font-size: 10px;
  border-radius: 8px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.chip {
  background: transparent;
  border: 1px solid var(--fg-dim);
  color: var(--fg-dim);
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 10px;
  cursor: pointer;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.chip:hover { color: var(--fg); border-color: var(--fg); }
.chipActive {
  color: var(--cyan);
  border-color: var(--cyan);
  text-shadow: var(--glow-cyan);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
  color: var(--fg);
}
.rowClickable {
  cursor: pointer;
  transition: background 80ms ease;
}
.rowClickable:hover { background: rgba(255, 128, 255, 0.06); }
.chevron {
  color: var(--fg-dim);
  width: 12px;
  display: inline-block;
  text-align: center;
}
.catPill {
  display: inline-block;
  font-size: 10px;
  font-weight: bold;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 2px;
  background: var(--bg-mid);
  border: 1px solid var(--fg-dim);
  color: var(--fg);
  min-width: 60px;
  text-align: center;
}
.catTodo { color: var(--pink); border-color: var(--pink); }
.catThought { color: var(--cyan); border-color: var(--cyan); }
.catReadLater { color: var(--yellow); border-color: var(--yellow); }
.statusNew { color: var(--fg-dim); border-color: var(--fg-dim); }
.statusProcessing {
  color: var(--cyan);
  border-color: var(--cyan);
  animation: pulseCyan 1.6s ease-in-out infinite;
}
.statusFailed { color: var(--danger); border-color: var(--danger); }
@keyframes pulseCyan {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
.rowTitle { color: var(--fg); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tags { display: inline-flex; gap: 4px; }
.tag {
  font-size: 10px;
  padding: 0 6px;
  background: rgba(0, 240, 255, 0.08);
  color: var(--cyan);
  border-radius: 2px;
}
.timeAgo { color: var(--fg-dim); font-size: 11px; font-variant-numeric: tabular-nums; }
.empty { color: var(--fg-dim); font-style: italic; padding: 8px 0; }
.expand {
  border-left: 2px solid var(--cyan);
  padding: 8px 12px 12px 16px;
  margin: 4px 0 8px 12px;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.5;
}
.expandFail { border-left-color: var(--danger); }
.summary { margin: 0 0 8px 0; color: var(--fg); }
.raw {
  background: var(--bg-mid);
  padding: 8px;
  border-radius: 3px;
  max-height: 240px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0 0 8px 0;
}
.rowFooter { display: flex; gap: 8px; justify-content: flex-end; }
.actionBtn {
  background: transparent;
  color: var(--fg-dim);
  border: 1px solid var(--fg-dim);
  padding: 2px 10px;
  font: inherit;
  font-size: 11px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.actionBtn:hover { color: var(--fg); border-color: var(--fg); }
.actionDanger:hover { color: var(--danger); border-color: var(--danger); }
.headerBtn {
  background: transparent;
  color: var(--fg-dim);
  border: 1px solid var(--fg-dim);
  padding: 2px 10px;
  margin-left: 6px;
  font: inherit;
  font-size: 11px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.headerBtn:hover { color: var(--fg); border-color: var(--fg); }
.failureLine { color: var(--danger); font-size: 12px; margin: 0 0 8px 0; }
```

- [ ] **Step 2: Replace `panels/braindump/ui.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import { useCaptureModal } from '../../web/src/lib/useCaptureModal';
import type { BodyResponse, Category, EntrySummary, EntryStatus, ListResponse } from './types';
import s from './ui.module.css';

type Tab = 'processed' | 'inbox';
type CategoryFilter = 'all' | Category;

const QK = ['braindump'] as const;

function timeAgo(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function categoryClass(cat: Category | undefined): string {
  if (cat === 'todo') return `${s.catPill} ${s.catTodo}`;
  if (cat === 'thought') return `${s.catPill} ${s.catThought}`;
  if (cat === 'read-later') return `${s.catPill} ${s.catReadLater}`;
  return s.catPill;
}

function categoryLabel(cat: Category | undefined): string {
  if (cat === 'todo') return 'TODO';
  if (cat === 'thought') return 'THOUGHT';
  if (cat === 'read-later') return 'READ-LATER';
  return '—';
}

function statusClass(st: EntryStatus): string {
  if (st === 'new') return `${s.catPill} ${s.statusNew}`;
  if (st === 'processing') return `${s.catPill} ${s.statusProcessing}`;
  if (st === 'failed') return `${s.catPill} ${s.statusFailed}`;
  return s.catPill;
}

function statusLabel(st: EntryStatus): string {
  if (st === 'new') return 'NEW';
  if (st === 'processing') return 'PROCESSING';
  if (st === 'failed') return 'FAILED';
  return st.toUpperCase();
}

function inboxTitle(entry: EntrySummary, bodyPreview: string | undefined): string {
  // For processing entries a short preview helps; body is lazy-fetched on expand,
  // so until then we just show the id-derived label.
  if (entry.title) return entry.title;
  if (bodyPreview) return bodyPreview.slice(0, 60).replace(/\s+/g, ' ');
  return entry.id;
}

const EntryBody = ({ id }: { id: string }) => {
  const { data, isLoading, error } = useQuery<BodyResponse>({
    queryKey: ['braindump-body', id] as const,
    queryFn: () => fetchJson<BodyResponse>(`/api/braindump/${encodeURIComponent(id)}`),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (isLoading) return <div>loading…</div>;
  if (error) return <div className={s.failureLine}>{(error as Error).message}</div>;
  return <pre className={s.raw}>{data?.rawText ?? ''}</pre>;
};

type RowProps = {
  entry: EntrySummary;
  now: Date;
  isOpen: boolean;
  onToggle: () => void;
  onReprocess: () => void;
  onDelete: () => void;
  kind: 'inbox' | 'processed';
};

const EntryRow = ({ entry, now, isOpen, onToggle, onReprocess, onDelete, kind }: RowProps) => {
  const title = kind === 'processed' ? entry.title ?? entry.id : inboxTitle(entry, undefined);
  return (
    <div>
      <div
        className={`${s.row} ${s.rowClickable}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
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
        {kind === 'processed' ? (
          <span className={categoryClass(entry.category)}>{categoryLabel(entry.category)}</span>
        ) : (
          <span className={statusClass(entry.status)}>{statusLabel(entry.status)}</span>
        )}
        <span className={s.rowTitle}>{title}</span>
        {entry.tags && entry.tags.length > 0 && (
          <span className={s.tags}>
            {entry.tags.map((t) => (
              <span key={t} className={s.tag}>
                {t}
              </span>
            ))}
          </span>
        )}
        <span className={s.timeAgo}>{timeAgo(entry.capturedAt, now)}</span>
      </div>
      {isOpen && (
        <div className={`${s.expand} ${entry.status === 'failed' ? s.expandFail : ''}`}>
          {entry.status === 'failed' && entry.failure && (
            <p className={s.failureLine}>
              processing failed ({entry.failure.attempts} attempts): {entry.failure.lastError}
            </p>
          )}
          {entry.summary && <p className={s.summary}>{entry.summary}</p>}
          <EntryBody id={entry.id} />
          <div className={s.rowFooter}>
            <button type="button" className={s.actionBtn} onClick={onReprocess}>
              {entry.status === 'failed' ? 'Retry' : 'Re-process'}
            </button>
            <button
              type="button"
              className={`${s.actionBtn} ${s.actionDanger}`}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const UI = () => {
  const qc = useQueryClient();
  const { open } = useCaptureModal();
  const [tab, setTab] = useState<Tab>('processed');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const now = new Date();

  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/braindump'),
  });

  const processNow = useMutation({
    mutationFn: async () =>
      fetchJson<{ processed: number; failed: number; skipped: number }>(
        '/api/braindump/process',
        { method: 'POST' },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const reprocess = useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ reprocessing: true }>(
        `/api/braindump/${encodeURIComponent(id)}/reprocess`,
        { method: 'POST' },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const del = useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ deleted: true }>(`/api/braindump/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const inbox = data?.inbox ?? [];
  const processed = data?.processed ?? [];
  const processedFiltered =
    filter === 'all' ? processed : processed.filter((e) => e.category === filter);

  return (
    <div className="panel">
      <div className="panel-header">
        Braindump
        <button type="button" className={s.headerBtn} onClick={open} title="New braindump (Cmd-Shift-B)">
          + new
        </button>
        <button
          type="button"
          className={s.headerBtn}
          onClick={() => processNow.mutate()}
          disabled={processNow.isPending}
        >
          {processNow.isPending ? 'processing…' : 'process now'}
        </button>
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        <div className={s.tabs}>
          <button
            type="button"
            className={`${s.tab} ${tab === 'processed' ? s.tabActive : ''}`}
            onClick={() => setTab('processed')}
          >
            Processed
          </button>
          <button
            type="button"
            className={`${s.tab} ${tab === 'inbox' ? s.tabActive : ''}`}
            onClick={() => setTab('inbox')}
          >
            Inbox
            {inbox.length > 0 && <span className={s.tabBadge}>{inbox.length}</span>}
          </button>
        </div>

        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}

        {tab === 'processed' && (
          <>
            <div className={s.chips}>
              {(['all', 'todo', 'thought', 'read-later'] as CategoryFilter[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${s.chip} ${filter === c ? s.chipActive : ''}`}
                  onClick={() => setFilter(c)}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
            {processedFiltered.length === 0 && !isLoading && (
              <p className={s.empty}>
                {processed.length === 0
                  ? 'No processed entries yet.'
                  : `No entries match "${filter}".`}
              </p>
            )}
            {processedFiltered.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                now={now}
                isOpen={openId === entry.id}
                onToggle={() => toggle(entry.id)}
                onReprocess={() => reprocess.mutate(entry.id)}
                onDelete={() => del.mutate(entry.id)}
                kind="processed"
              />
            ))}
          </>
        )}

        {tab === 'inbox' && (
          <>
            {inbox.length === 0 && !isLoading && (
              <p className={s.empty}>Nothing pending — waiting for the next processing tick.</p>
            )}
            {inbox.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                now={now}
                isOpen={openId === entry.id}
                onToggle={() => toggle(entry.id)}
                onReprocess={() => reprocess.mutate(entry.id)}
                onDelete={() => del.mutate(entry.id)}
                kind="inbox"
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Check `--yellow` theme variable exists**

The Processed category "read-later" uses `var(--yellow)`. Run:
`grep -n '\-\-yellow' web/src/theme/*.css`
Expected: at least one hit. If missing, add `--yellow: #f5d442;` to the root theme block in the same file where other color vars live, as a separate one-line commit with message `feat(theme): add --yellow var for braindump read-later pill`.

- [ ] **Step 4: Lint + typecheck + test**

```bash
pnpm fix && pnpm check && pnpm -r test
```

- [ ] **Step 5: Manual smoke — full cycle**

Run: `pnpm dev`. In browser:
1. Cmd-Shift-B → capture "buy milk tonight" → Cmd-Enter. Confirm toast-ish closed. File at `~/.claude/braindumps/`.
2. Click Inbox tab — entry appears with `NEW` pill.
3. Click "process now" — entry flips to `PROCESSING` then to Processed tab (it will disappear from Inbox if the real `claude -p` is installed and returns valid JSON). Verify the file now has `status: processed` and populated fields.
4. On the Processed tab, click the row → expand shows summary + raw text + Re-process + Delete buttons.
5. Click Delete → entry disappears, file removed from `~/.claude/braindumps/`.
6. If the real `claude -p` errors (e.g. not installed), confirm the entry shows `FAILED` with the error after a few ticks, and Retry is visible.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add panels/braindump/ui.tsx panels/braindump/ui.module.css
git commit -m "feat(panels/braindump): two-tab panel UI with filter chips + row actions"
```

---

## Task 11: Final verification + polish

- [ ] **Step 1: Full test suite**

Run: `pnpm -r test`
Expected: all pass.

- [ ] **Step 2: Lint**

Run: `pnpm check`
Expected: clean.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: `@cc/web` builds to `web/dist/` without errors.

- [ ] **Step 4: Review diff**

Run: `git log --oneline main..HEAD`
Expected: a logical sequence of commits ending with this task's work. No commits missing, no squashed-then-re-split oddities.

- [ ] **Step 5: Push the branch**

Only do this when all previous steps pass. Ask the user before pushing or creating a PR (per their CLAUDE.md: PRs are always `--draft`, and they confirm before push).

---

## Coverage trace (plan-vs-spec)

| Spec section | Covered by |
|---|---|
| Architecture (new workspace + two registries) | Task 1 |
| Data model frontmatter schema | Task 2 (serializer + tests) |
| Data model state machine | Task 2 + Task 4 |
| ID regex | Task 2 (`ID_REGEX`) + Task 5 (route guard) |
| Capture flow + validation (≤ 8000 chars, non-empty) | Task 2 (`createEntry`) + Task 5 (route) + Task 8 (modal) |
| Processing tick (hourly + boot + manual) | Task 4 (`processPending`) + Task 5 (`POST /process`) + Task 6 (main.ts wiring) |
| `claude -p` prompt + type guard | Task 3 |
| Reentrancy guard | Task 4 |
| Bounded-retry (3 attempts) → terminal `failed` | Task 2 (`markEntryFailed`) + Task 4 |
| Timeout (60s) | Task 4 (`defaultRunClaude`) |
| List read (inbox vs processed split) | Task 2 (`listEntries`) + Task 5 (`GET /`) |
| Body read (lazy) | Task 2 (`readEntryBody`) + Task 5 (`GET /:id`) + Task 10 (`EntryBody`) |
| Delete | Task 2 (`deleteEntry`) + Task 5 (`DELETE /:id`) + Task 10 (row action) |
| Reprocess / retry | Task 2 (`reprocessEntry`) + Task 5 (`POST /:id/reprocess`) + Task 10 (row action) |
| Panel UI: two tabs, Processed default | Task 10 |
| Category filter chips | Task 10 |
| Row format (chevron, pill, title, tags, time-ago) | Task 10 |
| Inbox status pills (`NEW` / `PROCESSING` / `FAILED`) | Task 10 |
| Failed-entry retry button + error display | Task 10 |
| Capture modal (auto-focus, Cmd-Enter, Esc, 8000 cap) | Task 8 |
| Global Cmd-Shift-B shortcut | Task 7 (hook) + Task 9 (wiring) |
| Panel header: `+` / Process now / refresh | Task 10 |
| Error handling (corrupt file skip, ENOENT, bad IDs) | Task 2 + Task 5 |
| Security (stdin piping, no shell interpolation, no raw text at info) | Task 4 (`defaultRunClaude` + logger.warn without raw text) |
| Testing (five test files) | Tasks 2, 3, 4, 5 (no web tests — consistent with codebase) |

Every spec requirement maps to at least one task. No placeholders, no "TBD" sections, no forward references to undefined functions.
