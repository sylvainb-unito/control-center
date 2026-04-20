# Claude Sessions Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `claude-sessions` panel that lists recent Claude Code sessions (last 10 office days) grouped by day, with a live/closed badge and a click action to open a Ghostty tab running `claude --resume <sessionId>` for closed sessions.

**Architecture:** New server module `server/src/lib/sessions.ts` parses `~/.claude/projects/*/*.jsonl` on demand, caches aggregates by `(path, mtime, size)`, and exposes `listRecentSessions` + `openSessionInGhostty`. New panel workspace `panels/claude-sessions/` exposes `GET /api/claude-sessions` and `POST /api/claude-sessions/open`. Pricing lives in `config/model-pricing.json`, loaded at server boot.

**Tech Stack:** TypeScript strict, Hono, React 18 + TanStack Query, Vitest, Biome, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-04-20-claude-sessions-design.md`

---

## File Structure

**New (server + config):**
- `server/src/lib/sessions.ts` — `officeDayCutoff`, `parseSessionFile`, `listRecentSessions`, `openSessionInGhostty`, `RemoveWorktreeResult`-style types.
- `server/src/lib/sessions.test.ts` — unit tests for all four.
- `config/model-pricing.json` — illustrative default rates for current Claude models.

**New (panel workspace):**
- `panels/claude-sessions/package.json`
- `panels/claude-sessions/tsconfig.json`
- `panels/claude-sessions/meta.ts`
- `panels/claude-sessions/types.ts`
- `panels/claude-sessions/api.ts`
- `panels/claude-sessions/api.test.ts`
- `panels/claude-sessions/ui.tsx`
- `panels/claude-sessions/ui.module.css`

**Changed:**
- `web/src/panels.ts` (register UI, order 40 — after the existing three)
- `server/src/routes.ts` (register API)

## Task Decomposition

Ten tasks, each leaving the workspace building and testable:

1. `officeDayCutoff` helper (pure, independent)
2. `parseSessionFile` streaming JSONL parser
3. Pricing config + `applyPricing`
4. `listRecentSessions` orchestrator with cache
5. `openSessionInGhostty` spawn helper
6. Panel workspace scaffold + registry wiring (stubs)
7. API handlers (`GET /` + `POST /open`)
8. UI stats strip + day-grouped list
9. UI live badge + click + refresh cadence
10. Final verification (lint + tests + typecheck + smoke)

---

## Task 1: `officeDayCutoff` helper

**Files:**
- Create: `server/src/lib/sessions.ts` (new, starts tiny)
- Create: `server/src/lib/sessions.test.ts`

Pure function. Subsequent tasks will grow `sessions.ts`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/sessions.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

describe('officeDayCutoff', () => {
  test('returns start-of-day of the weekday exactly N weekdays before now (weekday now)', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Wednesday 2026-04-22 local-noon → step back 10 weekdays → Wednesday 2026-04-08
    const now = new Date('2026-04-22T12:00:00');
    const cutoff = officeDayCutoff(now, 10);
    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(3); // April
    expect(cutoff.getDate()).toBe(8);
    expect(cutoff.getHours()).toBe(0);
    expect(cutoff.getMinutes()).toBe(0);
    expect(cutoff.getSeconds()).toBe(0);
  });

  test('skips Saturdays and Sundays while stepping back', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Monday 2026-04-20 → step back 1 weekday → Friday 2026-04-17
    const cutoff = officeDayCutoff(new Date('2026-04-20T12:00:00'), 1);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getDay()).toBe(5); // Friday
  });

  test('when now falls on a Sunday, steps back through preceding Saturday', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Sunday 2026-04-19 → step back 1 weekday → Friday 2026-04-17
    const cutoff = officeDayCutoff(new Date('2026-04-19T12:00:00'), 1);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getDay()).toBe(5);
  });

  test('officeDays=0 clamps now to start-of-day (no stepping)', async () => {
    const { officeDayCutoff } = await import('./sessions');
    const now = new Date('2026-04-22T15:30:45');
    const cutoff = officeDayCutoff(now, 0);
    expect(cutoff.getDate()).toBe(22);
    expect(cutoff.getHours()).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: all four tests fail with module-not-found or `officeDayCutoff is not a function`.

- [ ] **Step 3: Implement**

Create `server/src/lib/sessions.ts`:

```ts
export function officeDayCutoff(now: Date, officeDays: number): Date {
  // Cutoff = start-of-day of the weekday exactly `officeDays` weekdays before `now`.
  // The window is [cutoff, now], which includes `now`'s own date.
  const d = new Date(now);
  let remaining = officeDays;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/sessions.ts server/src/lib/sessions.test.ts
git commit -m "feat(server): officeDayCutoff helper for claude-sessions window"
```

---

## Task 2: `parseSessionFile` streaming JSONL parser

**Files:**
- Modify: `server/src/lib/sessions.ts`
- Modify: `server/src/lib/sessions.test.ts`

Streams a `Readable` line by line, tolerates unparseable lines, extracts aggregates for one session. Taking a `Readable` (not a path) keeps the function pure and tests hermetic.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/sessions.test.ts`:

```ts
import { Readable } from 'node:stream';

function streamOf(...lines: string[]): Readable {
  return Readable.from(lines.map((l) => `${l}\n`));
}

describe('parseSessionFile', () => {
  test('extracts aggregates from a small valid JSONL', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:00:00Z',
        sessionId: 'S1',
        cwd: '/Users/u/Workspace/proj',
        gitBranch: 'main',
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:00:30Z',
        sessionId: 'S1',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:05:00Z',
        sessionId: 'S1',
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:05:45Z',
        sessionId: 'S1',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 200, output_tokens: 90, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } },
      }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S1');
    expect(result).toEqual({
      sessionId: 'S1',
      cwd: '/Users/u/Workspace/proj',
      gitBranch: 'main',
      startedAt: '2026-04-22T10:00:00Z',
      lastActivityAt: '2026-04-22T10:05:45Z',
      messageCount: 4,
      primaryModel: 'claude-opus-4-7',
      tokensByModel: {
        'claude-opus-4-7': { input: 300, output: 140, cacheRead: 25, cacheCreation: 10 },
      },
    });
  });

  test('tolerates trailing incomplete line (session still being written)', async () => {
    const { parseSessionFile } = await import('./sessions');
    const full = JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S2', cwd: '/p' });
    const partial = '{"type":"assist'; // truncated mid-write
    const result = await parseSessionFile(streamOf(full, partial), 'S2');
    expect(result.messageCount).toBe(1);
    expect(result.startedAt).toBe('2026-04-22T10:00:00Z');
    expect(result.lastActivityAt).toBe('2026-04-22T10:00:00Z');
  });

  test('primary-model tie-break picks most-recent when output tokens equal', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S3', cwd: '/p' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-04-22T10:00:10Z', sessionId: 'S3',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 0, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-04-22T10:01:00Z', sessionId: 'S3',
        message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S3');
    expect(result.primaryModel).toBe('claude-sonnet-4-6');
  });

  test('session with no assistant lines has null primaryModel and empty tokensByModel', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S4', cwd: '/p' }),
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:30Z', sessionId: 'S4' }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S4');
    expect(result.primaryModel).toBeNull();
    expect(result.tokensByModel).toEqual({});
    expect(result.messageCount).toBe(2);
  });

  test('skips attachment/permission-mode lines for message count', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'S5' }),
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S5', cwd: '/p' }),
      JSON.stringify({ type: 'attachment', timestamp: '2026-04-22T10:00:01Z', sessionId: 'S5' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-04-22T10:00:10Z', sessionId: 'S5',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S5');
    expect(result.messageCount).toBe(2); // user + assistant only
  });

  test('returns null-ish fields if every line is unparseable', async () => {
    const { parseSessionFile } = await import('./sessions');
    const result = await parseSessionFile(streamOf('nope', 'also nope'), 'S6');
    expect(result.cwd).toBe('');
    expect(result.startedAt).toBe('');
    expect(result.messageCount).toBe(0);
    expect(result.primaryModel).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: six new tests fail (`parseSessionFile is not a function`). The `officeDayCutoff` tests still pass.

- [ ] **Step 3: Implement**

Append to `server/src/lib/sessions.ts`:

```ts
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { logger } from '../logger';

export type TokenBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type ParsedSession = {
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  primaryModel: string | null;
  tokensByModel: Record<string, TokenBucket>;
};

type AssistantUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type MaybeLine = {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: { model?: string; usage?: AssistantUsage };
};

function emptyBucket(): TokenBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

export async function parseSessionFile(
  stream: Readable,
  sessionId: string,
): Promise<ParsedSession> {
  const result: ParsedSession = {
    sessionId,
    cwd: '',
    gitBranch: null,
    startedAt: '',
    lastActivityAt: '',
    messageCount: 0,
    primaryModel: null,
    tokensByModel: {},
  };

  // Track the line index at which each model last appeared, for tie-breaking.
  const lastAssistantIdxByModel = new Map<string, number>();
  let lineIdx = 0;
  let loggedParseError = false;

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const raw of rl) {
    lineIdx++;
    if (!raw) continue;
    let obj: MaybeLine;
    try {
      obj = JSON.parse(raw) as MaybeLine;
    } catch {
      if (!loggedParseError) {
        logger.warn({ sessionId, lineIdx }, 'unparseable line in session jsonl (further errors in this session suppressed)');
        loggedParseError = true;
      }
      continue;
    }

    if (obj.cwd && !result.cwd) result.cwd = obj.cwd;
    if (obj.gitBranch && !result.gitBranch) result.gitBranch = obj.gitBranch;
    if (obj.timestamp) {
      if (!result.startedAt) result.startedAt = obj.timestamp;
      result.lastActivityAt = obj.timestamp;
    }
    if (obj.type === 'user' || obj.type === 'assistant') {
      result.messageCount++;
    }
    if (obj.type === 'assistant' && obj.message?.model && obj.message?.usage) {
      const model = obj.message.model;
      const usage = obj.message.usage;
      const bucket = result.tokensByModel[model] ?? emptyBucket();
      bucket.input += usage.input_tokens ?? 0;
      bucket.output += usage.output_tokens ?? 0;
      bucket.cacheRead += usage.cache_read_input_tokens ?? 0;
      bucket.cacheCreation += usage.cache_creation_input_tokens ?? 0;
      result.tokensByModel[model] = bucket;
      lastAssistantIdxByModel.set(model, lineIdx);
    }
  }

  // Primary model: highest output tokens; ties broken by most-recent assistant appearance.
  const models = Object.keys(result.tokensByModel);
  if (models.length > 0) {
    models.sort((a, b) => {
      const outA = result.tokensByModel[a]?.output ?? 0;
      const outB = result.tokensByModel[b]?.output ?? 0;
      if (outB !== outA) return outB - outA;
      const idxA = lastAssistantIdxByModel.get(a) ?? 0;
      const idxB = lastAssistantIdxByModel.get(b) ?? 0;
      return idxB - idxA;
    });
    result.primaryModel = models[0] ?? null;
  }

  return result;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: all ten tests (4 cutoff + 6 parser) pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/sessions.ts server/src/lib/sessions.test.ts
git commit -m "feat(server): streaming JSONL parser for claude session aggregates"
```

---

## Task 3: Pricing config + `applyPricing`

**Files:**
- Create: `config/model-pricing.json`
- Modify: `server/src/lib/sessions.ts`
- Modify: `server/src/lib/sessions.test.ts`

Adds `ModelPricing` type, `loadPricing(path)` reader, and `applyPricing(tokensByModel, pricing)` that produces `{ estCostUsd, pricingMissing }`. Pricing is loaded once at server boot (caller responsibility).

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/sessions.test.ts`:

```ts
describe('applyPricing', () => {
  const pricing = {
    'claude-opus-4-7': {
      inputPerMtok: 15.0,
      outputPerMtok: 75.0,
      cacheReadPerMtok: 1.5,
      cacheCreationPerMtok: 18.75,
    },
    'claude-sonnet-4-6': {
      inputPerMtok: 3.0,
      outputPerMtok: 15.0,
      cacheReadPerMtok: 0.3,
      cacheCreationPerMtok: 3.75,
    },
  };

  test('computes cost from tokensByModel using rates', async () => {
    const { applyPricing } = await import('./sessions');
    const tokensByModel = {
      'claude-opus-4-7': { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheCreation: 100_000 },
    };
    const { estCostUsd, pricingMissing } = applyPricing(tokensByModel, pricing);
    // input: 1M × $15 = $15; output: 0.5M × $75 = $37.5;
    // cacheRead: 2M × $1.5 = $3; cacheCreation: 0.1M × $18.75 = $1.875
    // total = 57.375
    expect(estCostUsd).toBeCloseTo(57.375, 3);
    expect(pricingMissing).toBe(false);
  });

  test('flags pricingMissing when a model has no rates, contributing zero', async () => {
    const { applyPricing } = await import('./sessions');
    const tokensByModel = {
      'claude-opus-4-7': { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
      'unknown-model-xyz': { input: 999_999, output: 999_999, cacheRead: 0, cacheCreation: 0 },
    };
    const { estCostUsd, pricingMissing } = applyPricing(tokensByModel, pricing);
    expect(estCostUsd).toBeCloseTo(15, 3); // only opus contributed
    expect(pricingMissing).toBe(true);
  });

  test('empty tokensByModel yields zero cost and no missing flag', async () => {
    const { applyPricing } = await import('./sessions');
    const { estCostUsd, pricingMissing } = applyPricing({}, pricing);
    expect(estCostUsd).toBe(0);
    expect(pricingMissing).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: three new tests fail with `applyPricing is not a function`.

- [ ] **Step 3: Create the pricing config**

Create `config/model-pricing.json`:

```json
{
  "claude-opus-4-7": {
    "inputPerMtok": 15.0,
    "outputPerMtok": 75.0,
    "cacheReadPerMtok": 1.5,
    "cacheCreationPerMtok": 18.75
  },
  "claude-sonnet-4-6": {
    "inputPerMtok": 3.0,
    "outputPerMtok": 15.0,
    "cacheReadPerMtok": 0.3,
    "cacheCreationPerMtok": 3.75
  },
  "claude-haiku-4-5-20251001": {
    "inputPerMtok": 1.0,
    "outputPerMtok": 5.0,
    "cacheReadPerMtok": 0.1,
    "cacheCreationPerMtok": 1.25
  }
}
```

Rates are illustrative placeholders — if you know the current Anthropic rates on 2026-04-20, use those instead. Missing models will degrade gracefully.

- [ ] **Step 4: Implement `applyPricing`**

Append to `server/src/lib/sessions.ts`:

```ts
import fs from 'node:fs';

export type ModelRates = {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheCreationPerMtok: number;
};

export type Pricing = Record<string, ModelRates>;

export function loadPricing(path: string): Pricing {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    return JSON.parse(raw) as Pricing;
  } catch (err) {
    logger.warn({ path, err: (err as Error)?.message }, 'failed to load model pricing; using empty pricing');
    return {};
  }
}

export function applyPricing(
  tokensByModel: Record<string, TokenBucket>,
  pricing: Pricing,
): { estCostUsd: number; pricingMissing: boolean } {
  let estCostUsd = 0;
  let pricingMissing = false;
  for (const [model, bucket] of Object.entries(tokensByModel)) {
    const rates = pricing[model];
    if (!rates) {
      pricingMissing = true;
      continue;
    }
    estCostUsd += (bucket.input / 1_000_000) * rates.inputPerMtok;
    estCostUsd += (bucket.output / 1_000_000) * rates.outputPerMtok;
    estCostUsd += (bucket.cacheRead / 1_000_000) * rates.cacheReadPerMtok;
    estCostUsd += (bucket.cacheCreation / 1_000_000) * rates.cacheCreationPerMtok;
  }
  return { estCostUsd, pricingMissing };
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: 13/13 pass.

- [ ] **Step 6: Commit**

```bash
git add config/model-pricing.json server/src/lib/sessions.ts server/src/lib/sessions.test.ts
git commit -m "feat(server): model pricing config and applyPricing helper"
```

---

## Task 4: `listRecentSessions` orchestrator with cache

**Files:**
- Modify: `server/src/lib/sessions.ts`
- Modify: `server/src/lib/sessions.test.ts`

Glob files, filter by mtime cutoff, parse (via cache), attach pricing, sort by startedAt desc, return `SessionSummary[]`. Cache is a module-level `Map`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/sessions.test.ts`:

```ts
describe('listRecentSessions', () => {
  // Deps-only type for the test helper. `clearCache` is on ListOptions, not ListDeps.
  type Deps = NonNullable<Parameters<typeof import('./sessions').listRecentSessions>[1]>;

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    const base: Deps = {
      now: () => new Date('2026-04-22T12:00:00Z').getTime(),
      home: '/home/u',
      pricing: {
        'claude-opus-4-7': { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheCreationPerMtok: 18.75 },
      },
      globber: async () => [],
      stat: async () => ({ mtimeMs: 0, size: 0 }),
      parser: async () => ({
        sessionId: 'X',
        cwd: '/p',
        gitBranch: 'main',
        startedAt: '2026-04-22T10:00:00Z',
        lastActivityAt: '2026-04-22T10:00:00Z',
        messageCount: 0,
        primaryModel: null,
        tokensByModel: {},
      }),
      openStream: async () => {
        throw new Error('unused in this test');
      },
    };
    return { ...base, ...overrides };
  }

  test('returns empty array when glob returns nothing', async () => {
    const { listRecentSessions } = await import('./sessions');
    const result = await listRecentSessions({ officeDays: 10 }, makeDeps());
    expect(result).toEqual([]);
  });

  test('includes only files with mtime >= cutoff', async () => {
    const { listRecentSessions } = await import('./sessions');
    // cutoff for 2026-04-22 with officeDays=10 is 2026-04-08 00:00 local
    const recent = new Date('2026-04-21T10:00:00Z').getTime();
    const old = new Date('2026-04-01T10:00:00Z').getTime();
    const deps = makeDeps({
      globber: async () => ['/home/u/.claude/projects/proj-1/aaa.jsonl', '/home/u/.claude/projects/proj-1/bbb.jsonl'],
      stat: async (p: string) => ({
        mtimeMs: p.endsWith('aaa.jsonl') ? recent : old,
        size: 1000,
      }),
      parser: async () => ({
        sessionId: 'S',
        cwd: '/Users/u/Workspace/proj',
        gitBranch: null,
        startedAt: '2026-04-21T10:00:00Z',
        lastActivityAt: '2026-04-21T10:00:00Z',
        messageCount: 1,
        primaryModel: null,
        tokensByModel: {},
      }),
    });
    const result = await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('aaa'); // UUID derives from filename
  });

  test('uses cache when (mtime, size) match; re-parses when mtime changes', async () => {
    const { listRecentSessions } = await import('./sessions');
    const mtime1 = new Date('2026-04-21T10:00:00Z').getTime();
    const mtime2 = mtime1 + 1000;
    let parseCalls = 0;
    const deps = makeDeps({
      globber: async () => ['/home/u/.claude/projects/proj-1/aaa.jsonl'],
      stat: async () => ({ mtimeMs: mtime1, size: 1000 }),
      parser: async () => {
        parseCalls++;
        return {
          sessionId: 'aaa',
          cwd: '/Users/u/Workspace/proj',
          gitBranch: null,
          startedAt: '2026-04-21T10:00:00Z',
          lastActivityAt: '2026-04-21T10:00:00Z',
          messageCount: 1,
          primaryModel: null,
          tokensByModel: {},
        };
      },
    });
    await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    expect(parseCalls).toBe(1);

    // Second call, same mtime → no re-parse
    await listRecentSessions({ officeDays: 10 }, deps);
    expect(parseCalls).toBe(1);

    // Third call, mtime changed → re-parse
    const deps2 = { ...deps, stat: async () => ({ mtimeMs: mtime2, size: 1000 }) };
    await listRecentSessions({ officeDays: 10 }, deps2);
    expect(parseCalls).toBe(2);
  });

  test('marks isLive when file mtime is within 120s of now', async () => {
    const { listRecentSessions } = await import('./sessions');
    const now = new Date('2026-04-22T12:00:00Z').getTime();
    const deps = makeDeps({
      now: () => now,
      globber: async () => [
        '/home/u/.claude/projects/proj-1/live.jsonl',
        '/home/u/.claude/projects/proj-1/old.jsonl',
      ],
      stat: async (p: string) => ({
        mtimeMs: p.endsWith('live.jsonl') ? now - 60_000 : now - 10 * 60_000,
        size: 1,
      }),
      parser: async (stream, id) => ({
        sessionId: id,
        cwd: '/Users/u/Workspace/proj',
        gitBranch: null,
        startedAt: '2026-04-22T11:00:00Z',
        lastActivityAt: '2026-04-22T11:00:00Z',
        messageCount: 1,
        primaryModel: null,
        tokensByModel: {},
      }),
    });
    const result = await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    const live = result.find((s) => s.sessionId === 'live');
    const oldRow = result.find((s) => s.sessionId === 'old');
    expect(live?.isLive).toBe(true);
    expect(oldRow?.isLive).toBe(false);
  });

  test('sorts by startedAt descending', async () => {
    const { listRecentSessions } = await import('./sessions');
    const deps = makeDeps({
      globber: async () => [
        '/home/u/.claude/projects/proj-1/early.jsonl',
        '/home/u/.claude/projects/proj-1/late.jsonl',
      ],
      stat: async () => ({ mtimeMs: new Date('2026-04-22T10:00:00Z').getTime(), size: 1 }),
      parser: async (_stream, id) => ({
        sessionId: id,
        cwd: '/Users/u/Workspace/proj',
        gitBranch: null,
        startedAt: id === 'late' ? '2026-04-22T11:00:00Z' : '2026-04-22T09:00:00Z',
        lastActivityAt: '2026-04-22T11:30:00Z',
        messageCount: 1,
        primaryModel: null,
        tokensByModel: {},
      }),
    });
    const result = await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    expect(result.map((s) => s.sessionId)).toEqual(['late', 'early']);
  });

  test('computes duration, project basename, estCostUsd, and pricingMissing per row', async () => {
    const { listRecentSessions } = await import('./sessions');
    const deps = makeDeps({
      globber: async () => ['/home/u/.claude/projects/encoded-cwd/aaa.jsonl'],
      stat: async () => ({ mtimeMs: new Date('2026-04-22T10:00:00Z').getTime(), size: 1 }),
      parser: async () => ({
        sessionId: 'aaa',
        cwd: '/Users/u/Workspace/my-repo',
        gitBranch: 'feat/x',
        startedAt: '2026-04-22T09:30:00Z',
        lastActivityAt: '2026-04-22T10:42:00Z',
        messageCount: 7,
        primaryModel: 'claude-opus-4-7',
        tokensByModel: {
          'claude-opus-4-7': { input: 2_000_000, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      }),
    });
    const [row] = await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    expect(row?.project).toBe('my-repo');
    expect(row?.durationMs).toBe(72 * 60_000); // 1h 12m
    expect(row?.estCostUsd).toBeCloseTo(30, 3); // 2M × $15
    expect(row?.pricingMissing).toBe(false);
    expect(row?.gitBranch).toBe('feat/x');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: six new tests fail with `listRecentSessions is not a function`.

- [ ] **Step 3: Implement**

Append to `server/src/lib/sessions.ts`:

```ts
import { glob as nativeGlob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type SessionSummary = {
  sessionId: string;
  project: string;
  cwd: string;
  gitBranch: string | null;
  startedAt: string;
  lastActivityAt: string;
  durationMs: number;
  messageCount: number;
  primaryModel: string | null;
  tokens: TokenBucket;
  estCostUsd: number;
  pricingMissing: boolean;
  isLive: boolean;
};

export type ListOptions = {
  officeDays: number;
  clearCache?: boolean;
};

export type ListDeps = {
  now?: () => number;
  home?: string;
  pricing?: Pricing;
  globber?: (pattern: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number; size: number }>;
  parser?: (stream: Readable, sessionId: string) => Promise<ParsedSession>;
  openStream?: (p: string) => Promise<Readable>;
};

type CacheEntry = { mtime: number; size: number; parsed: ParsedSession };
const cache = new Map<string, CacheEntry>();

const LIVE_THRESHOLD_MS = 120_000;

const defaultGlobber = async (pattern: string): Promise<string[]> => {
  const out: string[] = [];
  for await (const entry of nativeGlob(pattern)) out.push(entry as string);
  return out;
};

const defaultStat = async (p: string): Promise<{ mtimeMs: number; size: number }> => {
  const s = await fs.promises.stat(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
};

const defaultOpenStream = async (p: string): Promise<Readable> => {
  return fs.createReadStream(p);
};

function sumTokens(tokensByModel: Record<string, TokenBucket>): TokenBucket {
  const total = emptyBucket();
  for (const b of Object.values(tokensByModel)) {
    total.input += b.input;
    total.output += b.output;
    total.cacheRead += b.cacheRead;
    total.cacheCreation += b.cacheCreation;
  }
  return total;
}

export async function listRecentSessions(
  opts: ListOptions,
  deps: ListDeps = {},
): Promise<SessionSummary[]> {
  if (opts.clearCache) cache.clear();
  const now = deps.now ?? Date.now;
  const home = deps.home ?? os.homedir();
  const pricing = deps.pricing ?? {};
  const globber = deps.globber ?? defaultGlobber;
  const stat = deps.stat ?? defaultStat;
  const parser = deps.parser ?? parseSessionFile;
  const openStream = deps.openStream ?? defaultOpenStream;

  const cutoff = officeDayCutoff(new Date(now()), opts.officeDays).getTime();
  const pattern = path.join(home, '.claude', 'projects', '*', '*.jsonl');
  const files = await globber(pattern);

  const liveThreshold = now() - LIVE_THRESHOLD_MS;
  const surviving = new Set<string>();
  const rows: SessionSummary[] = [];

  for (const filePath of files) {
    const st = await stat(filePath).catch((err) => {
      logger.warn({ filePath, err: (err as Error)?.message }, 'stat failed; skipping');
      return null;
    });
    if (!st) continue;
    if (st.mtimeMs < cutoff) continue;
    surviving.add(filePath);

    let entry = cache.get(filePath);
    if (!entry || entry.mtime !== st.mtimeMs || entry.size !== st.size) {
      const sessionId = path.basename(filePath, '.jsonl');
      const stream = await openStream(filePath);
      try {
        const parsed = await parser(stream, sessionId);
        entry = { mtime: st.mtimeMs, size: st.size, parsed };
        cache.set(filePath, entry);
      } catch (err) {
        logger.warn({ filePath, err: (err as Error)?.message }, 'parse failed; skipping');
        continue;
      }
    }

    const { parsed } = entry;
    if (!parsed.startedAt) continue; // no parseable lines → skip entirely
    const tokens = sumTokens(parsed.tokensByModel);
    const { estCostUsd, pricingMissing } = applyPricing(parsed.tokensByModel, pricing);

    rows.push({
      sessionId: parsed.sessionId,
      project: path.basename(parsed.cwd),
      cwd: parsed.cwd,
      gitBranch: parsed.gitBranch,
      startedAt: parsed.startedAt,
      lastActivityAt: parsed.lastActivityAt,
      durationMs: Math.max(0, Date.parse(parsed.lastActivityAt) - Date.parse(parsed.startedAt)),
      messageCount: parsed.messageCount,
      primaryModel: parsed.primaryModel,
      tokens,
      estCostUsd,
      pricingMissing,
      isLive: st.mtimeMs >= liveThreshold,
    });
  }

  // Evict cache entries for files no longer in the window.
  for (const key of [...cache.keys()]) {
    if (!surviving.has(key)) cache.delete(key);
  }

  rows.sort((a, b) => (a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0));
  return rows;
}
```

The top-of-file import block needs `fs` too — if not already imported, add `import fs from 'node:fs';` to the top.

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: 19/19 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/sessions.ts server/src/lib/sessions.test.ts
git commit -m "feat(server): listRecentSessions orchestrator with mtime-keyed cache"
```

---

## Task 5: `openSessionInGhostty` spawn helper

**Files:**
- Modify: `server/src/lib/sessions.ts`
- Modify: `server/src/lib/sessions.test.ts`

Pure wrapper over `execFile` that runs `open -na Ghostty --args --working-directory=<cwd> -e claude --resume <id>`. Injectable runner for tests.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/sessions.test.ts`:

```ts
describe('openSessionInGhostty', () => {
  test('invokes open with Ghostty + working-directory + resume command', async () => {
    const { openSessionInGhostty } = await import('./sessions');
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner = async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return { stdout: '', stderr: '' };
    };
    await openSessionInGhostty('abc-123', '/Users/u/Workspace/proj', { runner });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('open');
    expect(calls[0]?.args).toEqual([
      '-na',
      'Ghostty',
      '--args',
      '--working-directory=/Users/u/Workspace/proj',
      '-e',
      'claude',
      '--resume',
      'abc-123',
    ]);
  });

  test('throws SpawnError when runner rejects', async () => {
    const { openSessionInGhostty, SpawnError } = await import('./sessions');
    const runner = async () => {
      throw new Error('Ghostty not found');
    };
    await expect(
      openSessionInGhostty('abc', '/p', { runner }),
    ).rejects.toBeInstanceOf(SpawnError);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: two new tests fail with `openSessionInGhostty is not a function`.

- [ ] **Step 3: Implement**

Append to `server/src/lib/sessions.ts`:

```ts
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export class SpawnError extends Error {
  readonly code = 'SPAWN_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'SpawnError';
  }
}

type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: Runner = async (cmd, args) => {
  const { stdout, stderr } = await execFileAsync(cmd, args);
  return { stdout, stderr };
};

export async function openSessionInGhostty(
  sessionId: string,
  cwd: string,
  opts: { runner?: Runner } = {},
): Promise<void> {
  const runner = opts.runner ?? defaultRunner;
  try {
    await runner('open', [
      '-na',
      'Ghostty',
      '--args',
      `--working-directory=${cwd}`,
      '-e',
      'claude',
      '--resume',
      sessionId,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ sessionId, cwd, err: msg }, 'ghostty spawn failed');
    throw new SpawnError(msg.slice(0, 200));
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter @cc/server test sessions.test
```
Expected: 21/21 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/sessions.ts server/src/lib/sessions.test.ts
git commit -m "feat(server): openSessionInGhostty spawn helper"
```

---

## Task 6: Panel workspace scaffold + registry wiring (stubs)

**Files:**
- Create: `panels/claude-sessions/package.json`
- Create: `panels/claude-sessions/tsconfig.json`
- Create: `panels/claude-sessions/meta.ts`
- Create: `panels/claude-sessions/types.ts`
- Create: `panels/claude-sessions/api.ts` (stub)
- Create: `panels/claude-sessions/ui.tsx` (stub)
- Create: `panels/claude-sessions/ui.module.css` (empty)
- Modify: `pnpm-workspace.yaml` (already matches `panels/*` — no edit needed; confirm)
- Modify: `web/src/panels.ts`
- Modify: `server/src/routes.ts`

Leaves the dashboard building, with the new panel rendering a "loading…" placeholder and `GET /api/claude-sessions` returning `501 NOT_IMPLEMENTED`. Task 7 fills in the real handlers.

- [ ] **Step 1: Create the workspace's `package.json`**

Create `panels/claude-sessions/package.json`:

```json
{
  "name": "@cc/panel-claude-sessions",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./ui": "./ui.tsx",
    "./api": "./api.ts",
    "./meta": "./meta.ts",
    "./types": "./types.ts"
  },
  "scripts": { "test": "vitest run" },
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

- [ ] **Step 2: Create `tsconfig.json` and `meta.ts`**

`panels/claude-sessions/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

`panels/claude-sessions/meta.ts`:

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'claude-sessions',
  title: 'Claude Sessions',
  order: 40,
  defaultSize: 'md',
};
```

- [ ] **Step 3: Create `types.ts` with the response shapes**

Create `panels/claude-sessions/types.ts`:

```ts
export type TokenBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type SessionSummary = {
  sessionId: string;
  project: string;
  cwd: string;
  gitBranch: string | null;
  startedAt: string;
  lastActivityAt: string;
  durationMs: number;
  messageCount: number;
  primaryModel: string | null;
  tokens: TokenBucket;
  estCostUsd: number;
  pricingMissing: boolean;
  isLive: boolean;
};

export type ListResponse = {
  sessions: SessionSummary[];
  stats: {
    count: number;
    durationMs: number;
    messageCount: number;
    tokens: TokenBucket;
    estCostUsd: number;
    pricingMissing: boolean;
  };
  window: {
    officeDays: number;
    cutoffAt: string;
  };
};
```

- [ ] **Step 4: Create API + UI stubs**

Create `panels/claude-sessions/api.ts`:

```ts
import { fail } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', (c) => c.json(fail('NOT_IMPLEMENTED', 'claude-sessions API coming in Task 7'), 501));
api.post('/open', (c) => c.json(fail('NOT_IMPLEMENTED', 'claude-sessions open coming in Task 7'), 501));
```

Create `panels/claude-sessions/ui.tsx`:

```tsx
export const UI = () => (
  <div className="panel">
    <div className="panel-header">Claude Sessions</div>
    <div className="panel-body">
      <p style={{ color: 'var(--fg-dim)' }}>loading… (scaffold)</p>
    </div>
  </div>
);
```

Create `panels/claude-sessions/ui.module.css` as an empty file (Task 8/9 populate it).

- [ ] **Step 5: Register in both registries**

Edit `web/src/panels.ts` — add the import and entry. After the existing imports and inside the `panels` array:

```ts
import { meta as sessionsMeta } from '../../panels/claude-sessions/meta';
import { UI as sessionsUI } from '../../panels/claude-sessions/ui';

// inside panels array:
  { meta: sessionsMeta, UI: sessionsUI },
```

Full final shape of `web/src/panels.ts`:

```ts
import type { PanelMeta, PanelUI } from '@cc/shared';
import { meta as sessionsMeta } from '../../panels/claude-sessions/meta';
import { UI as sessionsUI } from '../../panels/claude-sessions/ui';
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
];
```

Edit `server/src/routes.ts` — add the import and `app.route` call. Final shape:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { api as sessionsApi } from '../../panels/claude-sessions/api';
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
  app.use(
    '/logos/*',
    serveStatic({
      root: LOGOS,
      rewriteRequestPath: (p) => p.replace(/^\/logos/, ''),
    }),
  );
}
```

- [ ] **Step 6: Install the new workspace**

```bash
pnpm install
```
Expected: pnpm recognizes `@cc/panel-claude-sessions` and creates the lockfile entries. Exit 0.

- [ ] **Step 7: Run the full test suite and build**

```bash
pnpm -r test
```
Expected: all existing tests still pass; the new panel has no tests yet.

```bash
pnpm --filter @cc/server build
```
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add panels/claude-sessions pnpm-lock.yaml web/src/panels.ts server/src/routes.ts
git commit -m "feat(panels/claude-sessions): scaffold workspace and wire into registries"
```

---

## Task 7: API handlers (`GET /` and `POST /open`)

**Files:**
- Modify: `panels/claude-sessions/api.ts`
- Create: `panels/claude-sessions/api.test.ts`
- Modify: `server/src/main.ts` if it doesn't already load pricing (may require inspection — see Step 0)

Replace the stubs with real handlers. `GET /` calls `listRecentSessions`, attaches stats, returns envelope. `POST /open` validates the body against the cached session list, rejects live sessions with 409, spawns otherwise.

- [ ] **Step 0: Inspect `server/src/main.ts` for pricing-load integration**

Read `server/src/main.ts`. The handler needs the pricing map; the cleanest wiring is for `main.ts` to load it once at boot via `loadPricing(path)` and pass it down. If `main.ts` doesn't yet expose a place to inject shared config, create a small module-level `let pricing: Pricing = {}; export function setPricing(p: Pricing) { pricing = p; } export function getPricing() { return pricing; }` at the top of `panels/claude-sessions/api.ts` and call `setPricing` from `main.ts` at startup.

If `main.ts` can load it directly and pass into the api route factory, that is cleaner — prefer that if the existing shape allows it. Otherwise use the `setPricing` escape hatch; it's the smallest possible change that doesn't bleed global state.

Document the decision inline in the commit message.

- [ ] **Step 1: Write the failing tests**

Create `panels/claude-sessions/api.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/sessions', () => ({
  listRecentSessions: vi.fn(async () => []),
  openSessionInGhostty: vi.fn(async () => {}),
  officeDayCutoff: (now: Date) => {
    const d = new Date(now);
    d.setDate(d.getDate() - 14);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  SpawnError: class SpawnError extends Error {
    code = 'SPAWN_FAILED';
    constructor(m: string) {
      super(m);
    }
  },
}));

const sampleSession = {
  sessionId: 'abc',
  project: 'proj',
  cwd: '/Users/u/Workspace/proj',
  gitBranch: 'main',
  startedAt: '2026-04-22T09:00:00Z',
  lastActivityAt: '2026-04-22T10:00:00Z',
  durationMs: 60 * 60_000,
  messageCount: 10,
  primaryModel: 'claude-opus-4-7',
  tokens: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 },
  estCostUsd: 0.75,
  pricingMissing: false,
  isLive: false,
};

describe('claude-sessions api', () => {
  test('GET / returns envelope with sessions + stats + window', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      sampleSession,
      { ...sampleSession, sessionId: 'def', estCostUsd: 1.25, durationMs: 30 * 60_000, messageCount: 4 },
    ]);
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sessions).toHaveLength(2);
    expect(body.data.stats).toMatchObject({
      count: 2,
      messageCount: 14,
      durationMs: 90 * 60_000,
      estCostUsd: 2,
      pricingMissing: false,
    });
    expect(body.data.window.officeDays).toBe(10);
  });

  test('GET / propagates pricingMissing when any session has it', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...sampleSession, pricingMissing: true },
    ]);
    const { api } = await import('./api');
    const res = await api.request('/');
    const body = await res.json();
    expect(body.data.stats.pricingMissing).toBe(true);
  });

  test('POST /open with missing body fields returns 400 BAD_REQUEST', async () => {
    const { api } = await import('./api');
    const res = await api.request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'abc' }), // cwd missing
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('POST /open with unknown session returns 404 SESSION_NOT_FOUND', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([sampleSession]);
    const { api } = await import('./api');
    const res = await api.request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'unknown', cwd: '/wherever' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('SESSION_NOT_FOUND');
  });

  test('POST /open with live session returns 409 SESSION_LIVE and does not spawn', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...sampleSession, isLive: true },
    ]);
    (svc.openSessionInGhostty as unknown as ReturnType<typeof vi.fn>).mockClear();
    const { api } = await import('./api');
    const res = await api.request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sampleSession.sessionId, cwd: sampleSession.cwd }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('SESSION_LIVE');
    expect(svc.openSessionInGhostty).not.toHaveBeenCalled();
  });

  test('POST /open with valid closed session spawns ghostty and returns 200', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([sampleSession]);
    (svc.openSessionInGhostty as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const { api } = await import('./api');
    const res = await api.request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sampleSession.sessionId, cwd: sampleSession.cwd }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ opened: true });
    expect(svc.openSessionInGhostty).toHaveBeenCalledWith(sampleSession.sessionId, sampleSession.cwd);
  });

  test('POST /open surfaces SPAWN_FAILED when spawn helper throws', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([sampleSession]);
    const SpawnError = svc.SpawnError as new (m: string) => Error;
    (svc.openSessionInGhostty as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SpawnError('Ghostty not installed'),
    );
    const { api } = await import('./api');
    const res = await api.request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sampleSession.sessionId, cwd: sampleSession.cwd }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('SPAWN_FAILED');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/panel-claude-sessions test
```
Expected: all 7 tests fail — the handlers still return 501.

- [ ] **Step 3: Implement the handlers**

Replace `panels/claude-sessions/api.ts` with:

```ts
import { fail, ok } from '@cc/server/envelope';
import {
  type Pricing,
  type SessionSummary,
  SpawnError,
  listRecentSessions,
  openSessionInGhostty,
  officeDayCutoff,
} from '@cc/server/lib/sessions';
import { Hono } from 'hono';

const OFFICE_DAYS = 10;

// Pricing is injected by the server entrypoint (server/src/main.ts) at boot.
let pricing: Pricing = {};

export function setPricing(p: Pricing): void {
  pricing = p;
}

export const api = new Hono();

api.get('/', async (c) => {
  const sessions = await listRecentSessions({ officeDays: OFFICE_DAYS }, { pricing });
  const stats = sessions.reduce(
    (acc, s) => {
      acc.count++;
      acc.durationMs += s.durationMs;
      acc.messageCount += s.messageCount;
      acc.tokens.input += s.tokens.input;
      acc.tokens.output += s.tokens.output;
      acc.tokens.cacheRead += s.tokens.cacheRead;
      acc.tokens.cacheCreation += s.tokens.cacheCreation;
      acc.estCostUsd += s.estCostUsd;
      if (s.pricingMissing) acc.pricingMissing = true;
      return acc;
    },
    {
      count: 0,
      durationMs: 0,
      messageCount: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      estCostUsd: 0,
      pricingMissing: false,
    },
  );
  const cutoffAt = officeDayCutoff(new Date(), OFFICE_DAYS).toISOString();
  return c.json(
    ok({
      sessions,
      stats,
      window: { officeDays: OFFICE_DAYS, cutoffAt },
    }),
  );
});

api.post('/open', async (c) => {
  const body = await c.req.json<{ sessionId?: string; cwd?: string }>();
  if (!body?.sessionId || !body?.cwd) {
    return c.json(fail('BAD_REQUEST', 'sessionId and cwd required'), 400);
  }
  const sessions = await listRecentSessions({ officeDays: OFFICE_DAYS }, { pricing });
  const match = sessions.find(
    (s: SessionSummary) => s.sessionId === body.sessionId && s.cwd === body.cwd,
  );
  if (!match) {
    return c.json(fail('SESSION_NOT_FOUND', 'no matching session in the current window'), 404);
  }
  if (match.isLive) {
    return c.json(fail('SESSION_LIVE', 'session is currently open in another terminal'), 409);
  }
  try {
    await openSessionInGhostty(match.sessionId, match.cwd);
    return c.json(ok({ opened: true }));
  } catch (err) {
    if (err instanceof SpawnError) {
      return c.json(fail(err.code, err.message), 500);
    }
    throw err;
  }
});
```

- [ ] **Step 4: Wire pricing into `server/src/main.ts`**

Open `server/src/main.ts` and, after any existing boot-time setup, add:

```ts
import path from 'node:path';
import { loadPricing } from './lib/sessions';
import { setPricing } from '../../panels/claude-sessions/api';

const pricingPath = path.resolve(process.cwd(), 'config', 'model-pricing.json');
setPricing(loadPricing(pricingPath));
```

(Use the actual existing `path` import if already present; don't duplicate.) If the launchd environment's cwd isn't the repo root, replace `process.cwd()` with a path relative to `fileURLToPath(import.meta.url)` — mirror the pattern already used in `routes.ts` for `LOGOS`.

- [ ] **Step 5: Run tests — confirm they pass**

```bash
pnpm --filter @cc/panel-claude-sessions test
```
Expected: 7/7 tests pass.

```bash
pnpm -r test
```
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add panels/claude-sessions/api.ts panels/claude-sessions/api.test.ts server/src/main.ts
git commit -m "feat(panels/claude-sessions): GET list + POST open handlers with pricing"
```

---

## Task 8: UI — stats strip + day-grouped list (no click yet)

**Files:**
- Modify: `panels/claude-sessions/ui.tsx`
- Modify: `panels/claude-sessions/ui.module.css`

Read-only list rendering. No click, no live badge, no refresh cadence — those land in Task 9. Split to keep each UI diff reviewable.

- [ ] **Step 1: Populate CSS**

Replace `panels/claude-sessions/ui.module.css` with:

```css
.statsStrip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: var(--fg-dim);
  font-size: 12px;
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--fg-dim);
  margin-bottom: 10px;
}
.statsStrip strong {
  color: var(--pink);
  font-weight: bold;
}
.dayHeader {
  font-family: 'Orbitron', sans-serif;
  color: var(--cyan);
  letter-spacing: 1.5px;
  font-size: 12px;
  padding: 8px 0 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  padding: 4px 0;
}
.project {
  color: var(--fg);
  font-weight: bold;
  min-width: 120px;
}
.meta {
  color: var(--fg-dim);
  font-size: 11px;
}
.msgs {
  color: var(--fg-dim);
  font-size: 11px;
  margin-left: auto;
}
.pricingMissing {
  color: var(--yellow);
  font-size: 11px;
}
```

- [ ] **Step 2: Implement the list UI**

Replace `panels/claude-sessions/ui.tsx` with:

```tsx
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, SessionSummary } from './types';
import s from './ui.module.css';

const QK = ['claude-sessions'] as const;

function humanizeDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function dayHeaderLabel(iso: string, today: Date): string {
  const d = new Date(iso);
  const dStart = new Date(d);
  dStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayStart.getTime() - dStart.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return dStart.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return dStart.toISOString().slice(0, 10);
}

function groupByDay(sessions: SessionSummary[]): Array<{ label: string; rows: SessionSummary[] }> {
  const today = new Date();
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const d = new Date(session.startedAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const arr = groups.get(key) ?? [];
    arr.push(session);
    groups.set(key, arr);
  }
  const sortedKeys = [...groups.keys()].sort().reverse();
  return sortedKeys.map((key) => {
    const firstRow = groups.get(key)?.[0];
    const iso = firstRow?.startedAt ?? `${key}T00:00:00Z`;
    return {
      label: dayHeaderLabel(iso, today),
      rows: groups.get(key) ?? [],
    };
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatUsd(n: number): string {
  return `~$${n.toFixed(2)}`;
}

export const UI = () => {
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/claude-sessions'),
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Claude Sessions
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && data.sessions.length === 0 && (
          <p style={{ color: 'var(--fg-dim)' }}>No sessions in the last {data.window.officeDays} office days.</p>
        )}
        {data && data.sessions.length > 0 && (
          <>
            <div className={s.statsStrip}>
              <span>
                Last {data.window.officeDays} office days · <strong>{data.stats.count}</strong> sessions ·{' '}
                {humanizeDuration(data.stats.durationMs)} · {formatNumber(data.stats.messageCount)} msgs
              </span>
              <span>
                {formatNumber(data.stats.tokens.input)} in / {formatNumber(data.stats.tokens.output)} out /{' '}
                {formatNumber(data.stats.tokens.cacheRead + data.stats.tokens.cacheCreation)} cache ·{' '}
                <strong>{formatUsd(data.stats.estCostUsd)} est</strong>
                {data.stats.pricingMissing && <span className={s.pricingMissing}> (some rates missing)</span>}
              </span>
            </div>
            {groupByDay(data.sessions).map((group) => (
              <div key={group.label}>
                <div className={s.dayHeader}>{group.label}</div>
                {group.rows.map((row) => (
                  <div key={row.sessionId} className={s.row}>
                    <span className={s.project} title={row.cwd}>
                      {row.project}
                    </span>
                    <span className={s.meta}>
                      {row.gitBranch ?? '—'} · {row.primaryModel ?? '—'} · {humanizeDuration(row.durationMs)}
                    </span>
                    <span className={s.msgs}>{row.messageCount} msgs</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm -r test
```
Expected: all tests still pass; no new UI tests were added.

- [ ] **Step 4: Manual smoke (skip if no browser access)**

`pnpm dev`. Open `http://localhost:5173`. The new panel renders a stats strip, day headers, and rows. No click behaviour yet.

- [ ] **Step 5: Commit**

```bash
git add panels/claude-sessions/ui.tsx panels/claude-sessions/ui.module.css
git commit -m "feat(panels/claude-sessions): stats strip and day-grouped session list"
```

---

## Task 9: UI — live badge + click + auto-refresh cadence

**Files:**
- Modify: `panels/claude-sessions/ui.tsx`
- Modify: `panels/claude-sessions/ui.module.css`

Adds the pulsing live dot, `useMutation` for `POST /open`, disabled state on live rows with a tooltip, inline per-row error line for open failures, and `refetchInterval` that only polls while any `isLive` row is present.

- [ ] **Step 1: Append CSS for live dot + row click states**

Append to `panels/claude-sessions/ui.module.css`:

```css
.rowClickable {
  cursor: pointer;
  transition: background 80ms ease;
}
.rowClickable:hover {
  background: rgba(255, 128, 255, 0.06);
}
.rowLive {
  cursor: not-allowed;
  opacity: 0.8;
}
.liveDot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 6px var(--success);
  animation: livePulse 1.2s ease-in-out infinite;
  margin-right: 6px;
}
.liveBadge {
  color: var(--success);
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 1px;
  margin-right: 8px;
}
.rowError {
  color: var(--danger);
  font-size: 11px;
  margin: 2px 0 4px 28px;
}
.rowFlash {
  animation: rowFlash 600ms ease-out;
}
@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@keyframes rowFlash {
  0% { background: rgba(255, 128, 255, 0.35); }
  100% { background: transparent; }
}
```

- [ ] **Step 2: Extend `ui.tsx` with mutation + per-row state**

Replace the imports block and the `UI` component in `panels/claude-sessions/ui.tsx` with:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, SessionSummary } from './types';
import s from './ui.module.css';

const QK = ['claude-sessions'] as const;
const LIVE_POLL_MS = 30_000;

// (keep humanizeDuration, dayHeaderLabel, groupByDay, formatNumber, formatUsd exactly as in Task 8)

type OpenArgs = { sessionId: string; cwd: string };

export const UI = () => {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/claude-sessions'),
    staleTime: 30_000,
    refetchInterval: (q) => {
      const latest = q.state.data as ListResponse | undefined;
      return latest?.sessions.some((row) => row.isLive) ? LIVE_POLL_MS : false;
    },
  });

  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [flashingId, setFlashingId] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: async (args: OpenArgs) =>
      fetchJson<{ opened: true }>('/api/claude-sessions/open', {
        method: 'POST',
        body: JSON.stringify(args),
      }),
    onSuccess: (_data, args) => {
      setRowError((prev) => {
        const { [args.sessionId]: _drop, ...rest } = prev;
        return rest;
      });
      setFlashingId(args.sessionId);
      setTimeout(() => setFlashingId(null), 700);
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (err, args) => {
      setRowError((prev) => ({ ...prev, [args.sessionId]: (err as Error).message }));
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Claude Sessions
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && data.sessions.length === 0 && (
          <p style={{ color: 'var(--fg-dim)' }}>No sessions in the last {data.window.officeDays} office days.</p>
        )}
        {data && data.sessions.length > 0 && (
          <>
            <div className={s.statsStrip}>
              <span>
                Last {data.window.officeDays} office days · <strong>{data.stats.count}</strong> sessions ·{' '}
                {humanizeDuration(data.stats.durationMs)} · {formatNumber(data.stats.messageCount)} msgs
              </span>
              <span>
                {formatNumber(data.stats.tokens.input)} in / {formatNumber(data.stats.tokens.output)} out /{' '}
                {formatNumber(data.stats.tokens.cacheRead + data.stats.tokens.cacheCreation)} cache ·{' '}
                <strong>{formatUsd(data.stats.estCostUsd)} est</strong>
                {data.stats.pricingMissing && <span className={s.pricingMissing}> (some rates missing)</span>}
              </span>
            </div>
            {groupByDay(data.sessions).map((group) => (
              <div key={group.label}>
                <div className={s.dayHeader}>{group.label}</div>
                {group.rows.map((row) => {
                  const rowClassNames = [
                    s.row,
                    row.isLive ? s.rowLive : s.rowClickable,
                    flashingId === row.sessionId ? s.rowFlash : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const onClick = row.isLive
                    ? undefined
                    : () => open.mutate({ sessionId: row.sessionId, cwd: row.cwd });
                  const title = row.isLive
                    ? 'session open — switch to it manually (cmd-`)'
                    : row.cwd;
                  return (
                    <div key={row.sessionId}>
                      <div
                        className={rowClassNames}
                        onClick={onClick}
                        onKeyDown={(e) => {
                          if (!row.isLive && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            open.mutate({ sessionId: row.sessionId, cwd: row.cwd });
                          }
                        }}
                        role="button"
                        tabIndex={row.isLive ? -1 : 0}
                        aria-disabled={row.isLive}
                        title={title}
                      >
                        {row.isLive && <span className={s.liveDot} aria-hidden="true" />}
                        {row.isLive && <span className={s.liveBadge}>LIVE</span>}
                        <span className={s.project}>{row.project}</span>
                        <span className={s.meta}>
                          {row.gitBranch ?? '—'} · {row.primaryModel ?? '—'} · {humanizeDuration(row.durationMs)}
                        </span>
                        <span className={s.msgs}>{row.messageCount} msgs</span>
                      </div>
                      {rowError[row.sessionId] && (
                        <p className={s.rowError}>open failed: {rowError[row.sessionId]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
```

The five helpers (`humanizeDuration`, `dayHeaderLabel`, `groupByDay`, `formatNumber`, `formatUsd`) are unchanged from Task 8 — keep them as-is above the component.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm -r test
```
Expected: all tests still pass. No new UI tests.

- [ ] **Step 4: Manual smoke**

`pnpm dev`. Verify:
- A live session (current conversation's file is recent) shows a pulsing green dot + LIVE badge + disabled cursor.
- Clicking a non-live row briefly flashes the row background and spawns a new Ghostty window (if Ghostty is installed). On success the row disappears-or-stays depending on whether the reopened session is live — backend refresh decides.
- Clicking a live row does nothing; hovering shows the tooltip.
- If Ghostty is missing, clicking a row shows an inline red "open failed: …" line under that row only.

- [ ] **Step 5: Commit**

```bash
git add panels/claude-sessions/ui.tsx panels/claude-sessions/ui.module.css
git commit -m "feat(panels/claude-sessions): live badge, click-to-open, refetch polling"
```

---

## Task 10: Final verification

- [ ] **Step 1: Biome autofix**

```bash
pnpm fix
```
Expected: exit 0. If Biome reformats files, stage them for a separate cleanup commit after the verification below.

- [ ] **Step 2: Lint check**

```bash
pnpm check
```
Expected: exit 0, no diagnostics.

- [ ] **Step 3: Full test suite**

```bash
pnpm -r test
```
Expected: all suites pass, including the new sessions tests (~21 server + 7 panel) on top of the existing 46.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @cc/server build
```
Expected: exit 0. (`build` is a `tsc --noEmit` in this repo.)

- [ ] **Step 5: End-to-end smoke**

`pnpm dev`. Visit `http://localhost:5173`. Confirm:
- Claude Sessions panel shows at order 40 (after the existing three).
- Stats strip populated with at least one session (your current conversation's JSONL will qualify).
- Day headers render correctly: the current conversation should appear under "Today".
- Live dot pulses on the current session; that row is disabled with the tooltip.
- Closed-session rows are clickable. If Ghostty is installed, clicking opens a new window running `claude --resume`.
- Refreshing the page (or the refresh button) re-fetches without any console errors.

- [ ] **Step 6: Commit autofix output (only if the linter changed anything)**

```bash
git status
# only if the linter touched files not yet committed:
git add -A
git commit -m "chore: biome autofix"
```

---

## Self-review notes

- **Spec coverage check.** Each spec section has a task:
  - Window / cutoff math → Task 1.
  - Parser + aggregates → Task 2.
  - Pricing → Task 3.
  - `listRecentSessions` orchestrator + cache → Task 4.
  - Spawn helper → Task 5.
  - Panel scaffold + registry wiring → Task 6.
  - API handlers (`GET /`, `POST /open`) with the four error codes → Task 7.
  - UI layout (stats strip + day grouping + row anatomy) → Task 8.
  - Live badge + click + refresh cadence → Task 9.
  - Testing strategy sits in Tasks 1–5 and 7; Task 10 runs the full sweep.
  - Edge cases (empty dir, bad line, no-assistant session, etc.) covered by Tasks 2 + 4.
- **No retry / undo / AppleScript tab focusing / drill-in** — explicitly deferred by the spec's Non-goals.
- **Theme vars** only use existing tokens (`--success`, `--fg-dim`, `--danger`, `--yellow`, `--pink`, `--cyan`, `--fg`). No new theme entries.
