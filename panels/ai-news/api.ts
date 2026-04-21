import { ok } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/today', (c) => c.json(ok({ digest: null, state: { isRunning: false } })));
