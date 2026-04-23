import { describe, expect, test } from 'vitest';

import { makeHiddenStore } from './hidden-sessions';

// In-memory fs doubles.
function makeFakeFs() {
  const files = new Map<string, string>();
  return {
    files,
    readFile: (async (p: unknown) => {
      const content = files.get(String(p));
      if (content === undefined) {
        const err = new Error(`ENOENT: ${String(p)}`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return content;
    }) as unknown as typeof import('node:fs/promises').readFile,
    writeFile: (async (p: unknown, content: unknown) => {
      files.set(String(p), String(content));
    }) as unknown as typeof import('node:fs/promises').writeFile,
    mkdir: (async () => undefined) as unknown as typeof import('node:fs/promises').mkdir,
  };
}

describe('hidden-sessions', () => {
  test('list returns empty set when file does not exist', async () => {
    const fake = makeFakeFs();
    const store = makeHiddenStore({ home: '/home/u', ...fake });
    const result = await store.list();
    expect([...result]).toEqual([]);
  });

  test('add writes a sorted, de-duplicated list', async () => {
    const fake = makeFakeFs();
    const store = makeHiddenStore({ home: '/home/u', ...fake });
    await store.add(['b', 'a', 'a']);
    const content = fake.files.get('/home/u/.claude/sessions/hidden.json');
    expect(content).toBe(`${JSON.stringify({ hidden: ['a', 'b'] }, null, 2)}\n`);
  });

  test('add merges with existing file contents', async () => {
    const fake = makeFakeFs();
    fake.files.set(
      '/home/u/.claude/sessions/hidden.json',
      JSON.stringify({ hidden: ['existing'] }),
    );
    const store = makeHiddenStore({ home: '/home/u', ...fake });
    const after = await store.add(['new']);
    expect([...after].sort()).toEqual(['existing', 'new']);
  });

  test('remove drops ids but keeps others', async () => {
    const fake = makeFakeFs();
    fake.files.set(
      '/home/u/.claude/sessions/hidden.json',
      JSON.stringify({ hidden: ['keep', 'drop-me'] }),
    );
    const store = makeHiddenStore({ home: '/home/u', ...fake });
    const after = await store.remove(['drop-me', 'not-present']);
    expect([...after]).toEqual(['keep']);
  });

  test('list tolerates corrupt JSON as empty', async () => {
    const fake = makeFakeFs();
    fake.files.set('/home/u/.claude/sessions/hidden.json', '{not json');
    const store = makeHiddenStore({ home: '/home/u', ...fake });
    const result = await store.list();
    expect([...result]).toEqual([]);
  });

  test('list tolerates non-array hidden field as empty', async () => {
    const fake = makeFakeFs();
    fake.files.set('/home/u/.claude/sessions/hidden.json', '{"hidden":"oops"}');
    const store = makeHiddenStore({ home: '/home/u', ...fake });
    expect([...(await store.list())]).toEqual([]);
  });
});
