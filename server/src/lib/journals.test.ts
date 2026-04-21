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

    await listJournals({ ...buildDeps(100), clearCache: true });
    expect(readCalls).toBe(1);

    await listJournals(buildDeps(100));
    expect(readCalls).toBe(1);

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

    await listJournals({
      ...baseDeps,
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
    });
    expect(readCalls).toBe(1);

    const r2 = await listJournals({
      ...baseDeps,
      globber: async () => [],
    });
    expect(r2.daily).toEqual([]);

    await listJournals({
      ...baseDeps,
      globber: async (pattern: string) =>
        pattern.includes('/daily/') ? ['/home/u/.claude/journals/daily/2026-04-20.md'] : [],
    });
    expect(readCalls).toBe(2);
  });

  test('skips files whose stat call rejects', async () => {
    const { listJournals } = await import('./journals');
    const deps = makeDeps({
      clearCache: true,
      globber: async (pattern: string) =>
        pattern.includes('/daily/')
          ? ['/home/u/.claude/journals/daily/ok.md', '/home/u/.claude/journals/daily/nope.md']
          : [],
      stat: async (p: string) => {
        if (p.endsWith('nope.md')) throw new Error('EACCES: permission denied');
        return { mtimeMs: 100, size: 200 };
      },
      readFile: async () => `---
session: 1
repos: [r]
---
body
`,
    });
    const result = await listJournals(deps);
    expect(result.daily.map((j) => j.id)).toEqual(['ok']);
  });
});

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
        const err = new Error(
          "ENOENT: no such file or directory, open 'foo'",
        ) as NodeJS.ErrnoException;
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
