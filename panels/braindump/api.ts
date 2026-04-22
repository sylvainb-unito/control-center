import { fail, ok } from '@cc/server/envelope';
import {
  EntryNotFoundError,
  EntryReadError,
  ID_REGEX,
  createEntry,
  deleteEntry,
  listEntries,
  readEntryBody,
  reprocessEntry,
} from '@cc/server/lib/braindump';
import { processPending } from '@cc/server/lib/braindump-processor';
import { Hono } from 'hono';

export const api = new Hono();

api.post('/', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(fail('BAD_REQUEST', 'invalid JSON'), 400);
  }
  if (!payload || typeof payload !== 'object') {
    return c.json(fail('BAD_REQUEST', 'body must be a JSON object'), 400);
  }
  const rawText = (payload as { rawText?: unknown }).rawText;
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return c.json(fail('BAD_REQUEST', 'rawText is required'), 400);
  }
  try {
    const { id } = await createEntry(rawText);
    return c.json(ok({ id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/too long/i.test(msg)) return c.json(fail('BAD_REQUEST', msg), 400);
    if (/empty/i.test(msg)) return c.json(fail('BAD_REQUEST', msg), 400);
    return c.json(fail('WRITE_FAILED', msg), 500);
  }
});

api.get('/', async (c) => {
  const data = await listEntries();
  return c.json(ok(data));
});

api.post('/process', async (c) => {
  const data = await processPending({ retryFailed: true });
  return c.json(ok(data));
});

api.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  try {
    const rawText = await readEntryBody(id);
    return c.json(ok({ rawText }));
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    if (err instanceof EntryReadError) {
      return c.json(fail(err.code, err.message), 500);
    }
    throw err;
  }
});

api.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  try {
    await deleteEntry(id);
    return c.json(ok({ deleted: true }));
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    throw err;
  }
});

api.post('/:id/reprocess', async (c) => {
  const id = c.req.param('id');
  if (!ID_REGEX.test(id)) return c.json(fail('BAD_REQUEST', 'invalid id'), 400);
  try {
    await reprocessEntry(id);
    return c.json(ok({ reprocessing: true }));
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json(fail(err.code, err.message), 404);
    }
    throw err;
  }
});
