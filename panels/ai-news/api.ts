import { fail, ok } from '@cc/server/envelope';
import {
  DATE_REGEX,
  DigestNotFoundError,
  DigestReadError,
  ITEM_ID_REGEX,
  ItemNotFoundError,
  listStarred,
  readDigest,
  readState,
  toggleStar,
} from '@cc/server/lib/ai-news';
import { runDigest } from '@cc/server/lib/ai-news-processor';
import { Hono } from 'hono';

export const api = new Hono();

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

api.get('/today', async (c) => {
  const state = await readState();
  try {
    const digest = await readDigest(todayLocal());
    return c.json(ok({ digest, state }));
  } catch (err) {
    if (err instanceof DigestNotFoundError) return c.json(ok({ digest: null, state }));
    if (err instanceof DigestReadError) return c.json(fail('READ_FAILED', err.message), 500);
    throw err;
  }
});

api.get('/starred', async (c) => {
  try {
    const items = await listStarred();
    return c.json(ok({ items }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(fail('READ_FAILED', msg), 500);
  }
});

api.post('/digests/:date/items/:id/star', async (c) => {
  const date = c.req.param('date');
  const id = c.req.param('id');
  if (!DATE_REGEX.test(date)) return c.json(fail('BAD_REQUEST', 'invalid date'), 400);
  if (!ITEM_ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(fail('BAD_REQUEST', 'invalid JSON'), 400);
  }
  const starred = (body as { starred?: unknown })?.starred;
  if (typeof starred !== 'boolean')
    return c.json(fail('BAD_REQUEST', 'starred must be boolean'), 400);
  try {
    const r = await toggleStar(date, id, starred);
    return c.json(ok(r));
  } catch (err) {
    if (err instanceof DigestNotFoundError) return c.json(fail(err.code, err.message), 404);
    if (err instanceof ItemNotFoundError) return c.json(fail(err.code, err.message), 404);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(fail('WRITE_FAILED', msg), 500);
  }
});

api.post('/run', async (c) => {
  const state = await readState();
  if (state.isRunning) return c.json(fail('RUN_IN_PROGRESS', 'a run is in progress'), 409);
  void runDigest({ force: true }).catch(() => {
    /* runDigest captures its own failures into state.lastError */
  });
  return c.json(ok({ triggered: true as const }));
});
