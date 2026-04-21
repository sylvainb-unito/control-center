import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { Readable } from 'node:stream';
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
    expect(cutoff.getMilliseconds()).toBe(0);
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
    const originalMs = now.getTime();
    const cutoff = officeDayCutoff(now, 0);
    expect(cutoff.getDate()).toBe(22);
    expect(cutoff.getHours()).toBe(0);
    expect(now.getTime()).toBe(originalMs);
  });

  test('when now falls on a Saturday, steps back through preceding Friday', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Saturday 2026-04-18 → step back 1 weekday → Friday 2026-04-17
    const cutoff = officeDayCutoff(new Date('2026-04-18T12:00:00'), 1);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getDay()).toBe(5); // Friday
  });
});

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
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 10,
          },
        },
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
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 200,
            output_tokens: 90,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 0,
          },
        },
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
    const full = JSON.stringify({
      type: 'user',
      timestamp: '2026-04-22T10:00:00Z',
      sessionId: 'S2',
      cwd: '/p',
    });
    const partial = '{"type":"assist'; // truncated mid-write
    const result = await parseSessionFile(streamOf(full, partial), 'S2');
    expect(result.messageCount).toBe(1);
    expect(result.startedAt).toBe('2026-04-22T10:00:00Z');
    expect(result.lastActivityAt).toBe('2026-04-22T10:00:00Z');
  });

  test('primary-model tie-break picks most-recent when output tokens equal', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:00:00Z',
        sessionId: 'S3',
        cwd: '/p',
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:00:10Z',
        sessionId: 'S3',
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 0,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:01:00Z',
        sessionId: 'S3',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 0,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S3');
    expect(result.primaryModel).toBe('claude-sonnet-4-6');
  });

  test('session with no assistant lines has null primaryModel and empty tokensByModel', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:00:00Z',
        sessionId: 'S4',
        cwd: '/p',
      }),
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
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:00:00Z',
        sessionId: 'S5',
        cwd: '/p',
      }),
      JSON.stringify({ type: 'attachment', timestamp: '2026-04-22T10:00:01Z', sessionId: 'S5' }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:00:10Z',
        sessionId: 'S5',
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
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
    expect(result.tokensByModel).toEqual({});
  });
});

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
      'claude-opus-4-7': {
        input: 1_000_000,
        output: 500_000,
        cacheRead: 2_000_000,
        cacheCreation: 100_000,
      },
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

describe('loadPricing', () => {
  test('drops a model whose rates are not all finite numbers', async () => {
    const { loadPricing } = await import('./sessions');
    const tmp = nodePath.join(
      os.tmpdir(),
      `pricing-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        'claude-opus-4-7': {
          inputPerMtok: 15,
          outputPerMtok: 75,
          cacheReadPerMtok: 1.5,
          cacheCreationPerMtok: 18.75,
        },
        'broken-model': {
          inputPerMtok: 'fifteen',
          outputPerMtok: 75,
          cacheReadPerMtok: 1.5,
          cacheCreationPerMtok: 18.75,
        },
      }),
    );
    try {
      const result = loadPricing(tmp);
      expect(result['claude-opus-4-7']).toBeDefined();
      expect(result['broken-model']).toBeUndefined();
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('returns empty object when file does not exist', async () => {
    const { loadPricing } = await import('./sessions');
    const result = loadPricing('/nonexistent/path/pricing.json');
    expect(result).toEqual({});
  });
});

describe('listRecentSessions', () => {
  // Deps-only type for the test helper. `clearCache` is on ListOptions, not ListDeps.
  type Deps = NonNullable<Parameters<typeof import('./sessions').listRecentSessions>[1]>;

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    const base: Deps = {
      now: () => new Date('2026-04-22T12:00:00Z').getTime(),
      home: '/home/u',
      pricing: {
        'claude-opus-4-7': {
          inputPerMtok: 15,
          outputPerMtok: 75,
          cacheReadPerMtok: 1.5,
          cacheCreationPerMtok: 18.75,
        },
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
      openStream: async () => Readable.from([]),
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
      globber: async () => [
        '/home/u/.claude/projects/proj-1/aaa.jsonl',
        '/home/u/.claude/projects/proj-1/bbb.jsonl',
      ],
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

  test('evicts cache entries for files that fall out of the window', async () => {
    const { listRecentSessions } = await import('./sessions');
    // now1: 2026-04-22T12:00:00Z, officeDays=10 → cutoff 2026-04-08 local 00:00
    const now1 = new Date('2026-04-22T12:00:00Z').getTime();
    // File mtime just after cutoff for now1, but will be well before cutoff for now2.
    const fileMtime = new Date('2026-04-09T10:00:00Z').getTime();
    // now2: 2026-05-10 → cutoff advances well past fileMtime.
    const now2 = new Date('2026-05-10T12:00:00Z').getTime();

    let parseCalls = 0;
    const baseDeps = makeDeps({
      globber: async () => ['/home/u/.claude/projects/proj-1/evict.jsonl'],
      stat: async () => ({ mtimeMs: fileMtime, size: 1000 }),
      parser: async () => {
        parseCalls++;
        return {
          sessionId: 'evict',
          cwd: '/Users/u/Workspace/proj',
          gitBranch: null,
          startedAt: '2026-04-09T10:00:00Z',
          lastActivityAt: '2026-04-09T10:00:00Z',
          messageCount: 1,
          primaryModel: null,
          tokensByModel: {},
        };
      },
    });

    // Call 1 — now1, file is in window, should parse and cache.
    const r1 = await listRecentSessions(
      { officeDays: 10, clearCache: true },
      { ...baseDeps, now: () => now1 },
    );
    expect(r1).toHaveLength(1);
    expect(parseCalls).toBe(1);

    // Call 2 — now2, file falls out of window, entry should be evicted.
    const r2 = await listRecentSessions({ officeDays: 10 }, { ...baseDeps, now: () => now2 });
    expect(r2).toHaveLength(0);
    expect(parseCalls).toBe(1); // no re-parse: file was filtered out before cache lookup

    // Call 3 — back to now1; if eviction worked, this parses fresh. If the stale
    // entry survived call 2, parseCalls would stay at 1 (cache hit) instead of bumping to 2.
    const r3 = await listRecentSessions({ officeDays: 10 }, { ...baseDeps, now: () => now1 });
    expect(r3).toHaveLength(1);
    expect(parseCalls).toBe(2);
  });

  test('durationMs returns 0 when timestamps are unparseable', async () => {
    const { listRecentSessions } = await import('./sessions');
    const deps = makeDeps({
      globber: async () => ['/home/u/.claude/projects/proj-1/x.jsonl'],
      stat: async () => ({ mtimeMs: new Date('2026-04-22T10:00:00Z').getTime(), size: 1 }),
      parser: async () => ({
        sessionId: 'x',
        cwd: '/Users/u/Workspace/proj',
        gitBranch: null,
        startedAt: 'not-a-date',
        lastActivityAt: 'also-not-a-date',
        messageCount: 1,
        primaryModel: null,
        tokensByModel: {},
      }),
    });
    const result = await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    // The row is included because startedAt is non-empty (truthy), but durationMs
    // must not propagate NaN — it falls back to 0 when timestamps don't parse.
    expect(result[0]?.durationMs).toBe(0);
  });

  test('skips files whose stat call rejects', async () => {
    const { listRecentSessions } = await import('./sessions');
    const deps = makeDeps({
      globber: async () => [
        '/home/u/.claude/projects/proj-1/ok.jsonl',
        '/home/u/.claude/projects/proj-1/nope.jsonl',
      ],
      stat: async (p: string) => {
        if (p.endsWith('nope.jsonl')) throw new Error('EACCES: permission denied');
        return { mtimeMs: new Date('2026-04-22T10:00:00Z').getTime(), size: 1 };
      },
      parser: async (_stream, id) => ({
        sessionId: id,
        cwd: '/Users/u/Workspace/proj',
        gitBranch: null,
        startedAt: '2026-04-22T10:00:00Z',
        lastActivityAt: '2026-04-22T10:00:00Z',
        messageCount: 1,
        primaryModel: null,
        tokensByModel: {},
      }),
    });
    const result = await listRecentSessions({ officeDays: 10, clearCache: true }, deps);
    expect(result.map((s) => s.sessionId)).toEqual(['ok']);
  });
});

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
      '/bin/zsh',
      '-ilc',
      'claude --resume abc-123',
    ]);
  });

  test('throws SpawnError when runner rejects', async () => {
    const { openSessionInGhostty, SpawnError } = await import('./sessions');
    const runner = async () => {
      throw new Error('Ghostty not found');
    };
    await expect(openSessionInGhostty('abc', '/p', { runner })).rejects.toBeInstanceOf(SpawnError);
  });

  test('truncates long error messages to 200 chars', async () => {
    const { openSessionInGhostty, SpawnError } = await import('./sessions');
    const longMsg = 'x'.repeat(300);
    const runner = async () => {
      throw new Error(longMsg);
    };
    await expect(openSessionInGhostty('id', '/p', { runner })).rejects.toMatchObject({
      code: 'SPAWN_FAILED',
      message: 'x'.repeat(200),
    });
  });
});
