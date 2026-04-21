import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  DigestNotFoundError,
  DigestReadError,
  ItemNotFoundError,
  listDigests,
  listStarred,
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
    expect(await listDigests({ home })).toEqual([]);
  });

  test('listDigests returns dates sorted desc, skips non-matching names', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['2026-04-19.json', '2026-04-21.json', '2026-04-20.json', 'garbage.txt']) {
      fs.writeFileSync(path.join(dir, f), '{}');
    }
    expect(await listDigests({ home })).toEqual(['2026-04-21', '2026-04-20', '2026-04-19']);
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
    expect(got.items[0]?.starred).toBe(true);
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
    mk('2026-04-01', false);
    mk('2026-04-02', true);
    mk('2026-04-20', false);
    await pruneOldDigests(new Date('2026-04-21T12:00:00Z'), 7, { home });
    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toEqual(['2026-04-02.json', '2026-04-20.json']);
  });

  test('readState returns default when missing', async () => {
    expect(await readState({ home })).toEqual({ isRunning: false });
  });

  test('writeState round-trips', async () => {
    await writeState({ isRunning: true, lastRunAt: 'x' }, { home });
    expect(await readState({ home })).toEqual({ isRunning: true, lastRunAt: 'x' });
  });

  test('readState recovers from corrupt state file', async () => {
    const dir = path.join(home, '.claude', 'ai-news');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), '{not-json');
    expect(await readState({ home })).toEqual({ isRunning: false });
  });

  test('listStarred returns only starred items with digestDate, newest first', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-19.json'),
      JSON.stringify({
        date: '2026-04-19',
        runAt: 'x',
        summary: '',
        items: [
          {
            id: 'old',
            title: 't',
            oneLineSummary: 's',
            url: 'https://x',
            category: 'tool',
            starred: true,
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(dir, '2026-04-21.json'),
      JSON.stringify({
        date: '2026-04-21',
        runAt: 'x',
        summary: '',
        items: [
          {
            id: 'a',
            title: 't',
            oneLineSummary: 's',
            url: 'https://x',
            category: 'tool',
            starred: true,
          },
          {
            id: 'b',
            title: 't',
            oneLineSummary: 's',
            url: 'https://y',
            category: 'tool',
            starred: false,
          },
        ],
      }),
    );
    const got = await listStarred({ home });
    expect(got).toHaveLength(2);
    expect(got[0]?.digestDate).toBe('2026-04-21');
    expect(got[0]?.id).toBe('a');
    expect(got[1]?.digestDate).toBe('2026-04-19');
  });
});
