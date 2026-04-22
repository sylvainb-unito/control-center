import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatLocalDate } from '@cc/server/lib/ai-news';
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
    if (prevHome === undefined) {
      Reflect.deleteProperty(process.env, 'HOME');
    } else {
      process.env.HOME = prevHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const call = (url: string, init?: RequestInit) =>
    api.request(new Request(`http://localhost${url}`, init));

  test('GET /today returns null digest + default state when nothing exists', async () => {
    const res = await call('/today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { digest: null; state: { isRunning: boolean } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.digest).toBeNull();
    expect(body.data.state.isRunning).toBe(false);
  });

  test('GET /today returns populated digest when file exists', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    const d = formatLocalDate(new Date());
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
    const body = (await res.json()) as {
      ok: boolean;
      data: { digest: { items: unknown[] } };
    };
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
    expect(body.data.items[0]?.digestDate).toBe('2026-04-20');
    expect(body.data.items[0]?.id).toBe('a');
  });

  test('POST /digests/:date/items/:id/star returns 400 on non-boolean starred', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-21.json'),
      JSON.stringify({ date: '2026-04-21', runAt: 'x', summary: '', items: [] }),
    );
    const res = await call('/digests/2026-04-21/items/abc/star', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starred: 'yes' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('GET /today returns 500 READ_FAILED when digest JSON is malformed', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${formatLocalDate(new Date())}.json`), '{not json');
    const res = await call('/today');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe('READ_FAILED');
  });

  test('POST /digests/:date/items/:id/star returns 400 on invalid JSON body', async () => {
    const res = await call('/digests/2026-04-21/items/abc/star', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});
