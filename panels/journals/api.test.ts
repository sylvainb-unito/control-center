import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/journals', () => ({
  TIERS: ['daily', 'weekly', 'monthly'],
  listJournals: vi.fn(async () => ({ daily: [], weekly: [], monthly: [] })),
  readJournalBody: vi.fn(async () => ''),
  JournalNotFoundError: class JournalNotFoundError extends Error {
    code = 'JOURNAL_NOT_FOUND';
  },
  JournalReadError: class JournalReadError extends Error {
    code = 'READ_FAILED';
  },
}));

const sampleSummary = {
  id: '2026-04-20',
  tier: 'daily' as const,
  date: '2026-04-20',
  repos: ['control-center'],
  sessions: 3,
};

describe('journals api', () => {
  test('GET / returns envelope with all three tiers', async () => {
    const svc = await import('@cc/server/lib/journals');
    (svc.listJournals as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      daily: [sampleSummary],
      weekly: [],
      monthly: [],
    });
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.daily).toHaveLength(1);
    expect(body.data.weekly).toEqual([]);
    expect(body.data.monthly).toEqual([]);
  });

  test('GET /:tier/:id returns 200 with body on success', async () => {
    const svc = await import('@cc/server/lib/journals');
    (svc.readJournalBody as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '## Completed\n- Did stuff\n',
    );
    const { api } = await import('./api');
    const res = await api.request('/daily/2026-04-20');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { body: '## Completed\n- Did stuff\n' } });
    expect(svc.readJournalBody).toHaveBeenCalledWith('daily', '2026-04-20');
  });

  test('GET /:tier/:id returns 400 BAD_REQUEST on invalid tier', async () => {
    const { api } = await import('./api');
    const res = await api.request('/unknown/2026-04-20');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('GET /:tier/:id returns 400 BAD_REQUEST on traversal-style id', async () => {
    const { api } = await import('./api');
    const res = await api.request('/daily/..%2Ffoo');
    // ..%2F decodes to ../foo which fails the [A-Za-z0-9-]+ check
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('GET /:tier/:id returns 404 JOURNAL_NOT_FOUND when file missing', async () => {
    const svc = await import('@cc/server/lib/journals');
    const NotFound = svc.JournalNotFoundError as new (m: string) => Error;
    (svc.readJournalBody as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NotFound('missing'),
    );
    const { api } = await import('./api');
    const res = await api.request('/daily/2099-01-01');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('JOURNAL_NOT_FOUND');
  });

  test('GET /:tier/:id returns 500 READ_FAILED on filesystem error', async () => {
    const svc = await import('@cc/server/lib/journals');
    const ReadErr = svc.JournalReadError as new (m: string) => Error;
    (svc.readJournalBody as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ReadErr('EACCES'),
    );
    const { api } = await import('./api');
    const res = await api.request('/daily/2026-04-20');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('READ_FAILED');
  });
});
