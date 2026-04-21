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
