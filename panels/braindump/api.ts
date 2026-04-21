import { ok } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', (c) => c.json(ok({ inbox: [], processed: [] })));
