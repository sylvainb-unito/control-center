import { fail, ok } from '@cc/server/envelope';
import { makeHiddenStore } from '@cc/server/lib/hidden-sessions';
import {
  type SessionSummary,
  SpawnError,
  listRecentSessions,
  officeDayCutoff,
  openSessionInGhostty,
} from '@cc/server/lib/sessions';
import { Hono } from 'hono';

const OFFICE_DAYS = 10;

export const api = new Hono();

api.get('/', async (c) => {
  const nowMs = Date.now();
  const includeHidden = c.req.query('includeHidden') === 'true';
  const sessions = await listRecentSessions(
    { officeDays: OFFICE_DAYS, includeHidden },
    { now: () => nowMs },
  );
  const stats = sessions.reduce(
    (acc, s) => {
      acc.count++;
      acc.durationMs += s.durationMs;
      acc.messageCount += s.messageCount;
      acc.tokens.input += s.tokens.input;
      acc.tokens.output += s.tokens.output;
      acc.tokens.cacheRead += s.tokens.cacheRead;
      acc.tokens.cacheCreation += s.tokens.cacheCreation;
      return acc;
    },
    {
      count: 0,
      durationMs: 0,
      messageCount: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    },
  );
  const cutoffAt = officeDayCutoff(new Date(nowMs), OFFICE_DAYS).toISOString();
  return c.json(
    ok({
      sessions,
      stats,
      window: { officeDays: OFFICE_DAYS, cutoffAt },
    }),
  );
});

api.post('/hide', async (c) => {
  const body = await c.req
    .json<{ sessionIds?: string[] }>()
    .catch(() => ({}) as { sessionIds?: string[] });
  if (
    !Array.isArray(body.sessionIds) ||
    body.sessionIds.some((id: unknown) => typeof id !== 'string')
  ) {
    return c.json(fail('BAD_REQUEST', 'sessionIds: string[] required'), 400);
  }
  const store = makeHiddenStore();
  const hidden = await store.add(body.sessionIds);
  return c.json(ok({ hidden: [...hidden].sort() }));
});

api.post('/unhide', async (c) => {
  const body = await c.req
    .json<{ sessionIds?: string[] }>()
    .catch(() => ({}) as { sessionIds?: string[] });
  if (
    !Array.isArray(body.sessionIds) ||
    body.sessionIds.some((id: unknown) => typeof id !== 'string')
  ) {
    return c.json(fail('BAD_REQUEST', 'sessionIds: string[] required'), 400);
  }
  const store = makeHiddenStore();
  const hidden = await store.remove(body.sessionIds);
  return c.json(ok({ hidden: [...hidden].sort() }));
});

api.post('/open', async (c) => {
  const body = await c.req.json<{ sessionId?: string; cwd?: string }>();
  if (!body?.sessionId || !body?.cwd) {
    return c.json(fail('BAD_REQUEST', 'sessionId and cwd required'), 400);
  }
  const sessions = await listRecentSessions({ officeDays: OFFICE_DAYS });
  const match = sessions.find(
    (s: SessionSummary) => s.sessionId === body.sessionId && s.cwd === body.cwd,
  );
  if (!match) {
    return c.json(fail('SESSION_NOT_FOUND', 'no matching session in the current window'), 404);
  }
  if (match.isLive) {
    return c.json(fail('SESSION_LIVE', 'session is currently open in another terminal'), 409);
  }
  try {
    await openSessionInGhostty(match.sessionId, match.cwd);
    return c.json(ok({ opened: true }));
  } catch (err) {
    if (err instanceof SpawnError) {
      return c.json(fail(err.code, err.message), 500);
    }
    throw err;
  }
});
