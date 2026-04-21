import { fail, ok } from '@cc/server/envelope';
import {
  JournalNotFoundError,
  JournalReadError,
  listJournals,
  readJournalBody,
} from '@cc/server/lib/journals';
import { Hono } from 'hono';

const VALID_TIERS = new Set(['daily', 'weekly', 'monthly']);
const ID_PATTERN = /^[A-Za-z0-9-]+$/;

export const api = new Hono();

api.get('/', async (c) => {
  const data = await listJournals();
  return c.json(ok(data));
});

api.get('/:tier/:id', async (c) => {
  const tier = c.req.param('tier');
  const id = c.req.param('id');
  if (!VALID_TIERS.has(tier) || !ID_PATTERN.test(id)) {
    return c.json(fail('BAD_REQUEST', 'invalid tier or id'), 400);
  }
  try {
    const body = await readJournalBody(tier as 'daily' | 'weekly' | 'monthly', id);
    return c.json(ok({ body }));
  } catch (err) {
    if (err instanceof JournalNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    if (err instanceof JournalReadError) {
      return c.json(fail(err.code, err.message), 500);
    }
    throw err;
  }
});
