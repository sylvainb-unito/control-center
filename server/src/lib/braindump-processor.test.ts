// server/src/lib/braindump-processor.test.ts
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
      a7f3: `---
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

describe('processPending — failures', () => {
  test('invalid JSON output → failed bookkeeping, attempts=1, status:new', async () => {
    const { processPending } = await import('./braindump-processor');
    const fs = makeFakeFs({
      a7f3: `---
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
      a7f3: `---
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
      a7f3: `---
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
      a7f3: `---
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

describe('processPending — timeout threading', () => {
  test('runClaude receives DEFAULT_TIMEOUT_MS when deps.timeoutMs is omitted', async () => {
    const { processPending, _resetForTests } = await import('./braindump-processor');
    _resetForTests();
    const fs = makeFakeFs({
      a7f3: `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    let capturedTimeoutMs: unknown;
    const runClaude = vi.fn(async (args: { timeoutMs: unknown }) => {
      capturedTimeoutMs = args.timeoutMs;
      return JSON.stringify({
        category: 'thought',
        title: 't',
        summary: 's',
        tags: [],
      });
    });
    await processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
      // NOTE: timeoutMs intentionally omitted
    });
    expect(capturedTimeoutMs).toBe(60_000);
  });
});

describe('processPending — reentrancy', () => {
  test('concurrent calls: second one no-ops while first is running', async () => {
    const { processPending, _resetForTests } = await import('./braindump-processor');
    _resetForTests();
    const fs = makeFakeFs({
      a7f3: `---
id: a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
x`,
    });
    let resolveFirst!: (v: string) => void;
    // claudeStarted resolves when the first runClaude call is actually invoked.
    let signalClaudeStarted!: () => void;
    const claudeStarted = new Promise<void>((r) => {
      signalClaudeStarted = r;
    });
    const firstClaude = new Promise<string>((r) => {
      resolveFirst = r;
    });
    const runClaude = vi.fn(async () => {
      signalClaudeStarted();
      return firstClaude;
    });

    const p1 = processPending({
      home: fs.home,
      readdir: fs.readdir,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      runClaude,
      now: () => new Date('2026-04-21T15:00:00.000Z'),
    });

    // Wait until p1 has actually reached the runClaude call (isProcessing is firmly set).
    await claudeStarted;

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

    resolveFirst(JSON.stringify({ category: 'thought', title: 't', summary: 's', tags: [] }));
    await p1;
  });
});
