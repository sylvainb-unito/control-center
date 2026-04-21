import { fail, ok } from '@cc/server/envelope';
import {
  type Pricing,
  type SessionSummary,
  SpawnError,
  listRecentSessions,
  officeDayCutoff,
  openSessionInGhostty,
} from '@cc/server/lib/sessions';
import { Hono } from 'hono';

const OFFICE_DAYS = 10;

// Pricing is injected by the server entrypoint (server/src/main.ts) at boot.
let pricing: Pricing = {};

export function setPricing(p: Pricing): void {
  pricing = p;
}

export const api = new Hono();

api.get('/', async (c) => {
  const nowMs = Date.now();
  const sessions = await listRecentSessions(
    { officeDays: OFFICE_DAYS },
    { pricing, now: () => nowMs },
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
      acc.estCostUsd += s.estCostUsd;
      if (s.pricingMissing) acc.pricingMissing = true;
      return acc;
    },
    {
      count: 0,
      durationMs: 0,
      messageCount: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      estCostUsd: 0,
      pricingMissing: false,
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

api.post('/open', async (c) => {
  const body = await c.req.json<{ sessionId?: string; cwd?: string }>();
  if (!body?.sessionId || !body?.cwd) {
    return c.json(fail('BAD_REQUEST', 'sessionId and cwd required'), 400);
  }
  const sessions = await listRecentSessions({ officeDays: OFFICE_DAYS }, { pricing });
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
