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
  isLive: false,
};

describe('claude-sessions api', () => {
  test('GET / returns envelope with sessions + stats + window', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      sampleSession,
      {
        ...sampleSession,
        sessionId: 'def',
        durationMs: 30 * 60_000,
        messageCount: 4,
      },
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
      tokens: { input: 2000, output: 1000, cacheRead: 0, cacheCreation: 0 },
    });
    expect(body.data.window.officeDays).toBe(10);
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
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      sampleSession,
    ]);
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
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      sampleSession,
    ]);
    (svc.openSessionInGhostty as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );
    const { api } = await import('./api');
    const res = await api.request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sampleSession.sessionId, cwd: sampleSession.cwd }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ opened: true });
    expect(svc.openSessionInGhostty).toHaveBeenCalledWith(
      sampleSession.sessionId,
      sampleSession.cwd,
    );
  });

  test('POST /open surfaces SPAWN_FAILED when spawn helper throws', async () => {
    const svc = await import('@cc/server/lib/sessions');
    (svc.listRecentSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      sampleSession,
    ]);
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
