import { fail } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', (c) => c.json(fail('NOT_IMPLEMENTED', 'claude-sessions API coming in Task 7'), 501));
api.post('/open', (c) => c.json(fail('NOT_IMPLEMENTED', 'claude-sessions open coming in Task 7'), 501));
