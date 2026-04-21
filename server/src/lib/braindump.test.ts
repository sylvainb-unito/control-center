import path from 'node:path';
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
    expect(writes[0]?.data).toContain('id: 2026-04-21T14-32-08-a7f3');
    // gray-matter/js-yaml may quote the ISO timestamp with single quotes, double quotes, or unquoted
    expect(writes[0]?.data).toMatch(/capturedAt:\s*['"]?2026-04-21T14:32:08\.412Z['"]?/);
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
      readdir: async () => ['2026-04-21T14-32-08-a7f3.md', '2026-04-21T14-00-00-bbbb.md'],
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
    expect(result.processed[0]?.processedAt).toBe('2026-04-21T15:00:00.000Z');
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

  test('attaches a whitespace-normalized preview truncated to 60 chars', async () => {
    const { listEntries } = await import('./braindump');
    const long = 'pick up milk,\n\n  bread,\tand eggs tonight after the gym session closes';
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['2026-04-21T14-32-08-a7f3.md'],
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
${long}`,
    });
    const preview = result.inbox[0]?.preview;
    expect(preview).toBeDefined();
    expect(preview).toMatch(/^pick up milk, bread, and eggs/);
    expect(preview?.endsWith('…')).toBe(true);
    expect(preview?.length).toBe(61); // 60 chars + ellipsis
  });

  test('omits preview for empty-body entries', async () => {
    const { listEntries } = await import('./braindump');
    const result = await listEntries({
      ...makeDeps(),
      readdir: async () => ['2026-04-21T14-32-08-a7f3.md'],
      readFile: async () => `---
id: 2026-04-21T14-32-08-a7f3
capturedAt: 2026-04-21T14:32:08.412Z
status: new
---
`,
    });
    expect(result.inbox[0]?.preview).toBeUndefined();
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
    await expect(readEntryBody('2026-04-21T14-32-08-a7f3', deps)).rejects.toBeInstanceOf(
      EntryNotFoundError,
    );
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
    await expect(readEntryBody('2026-04-21T14-32-08-a7f3', deps)).rejects.toBeInstanceOf(
      EntryReadError,
    );
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
    // matter.stringify appends a trailing newline after the body
    expect(writes[0]?.data).toMatch(/---\nraw body\n?$/);
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
        readFile: async () => baseFront.replace('status: new', 'status: processing'),
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
    // matter.stringify appends a trailing newline after the body
    expect(data).toMatch(/---\nraw body\n?$/);
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
          readFile: async () => baseFront.replace('status: new', 'status: processing'),
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
