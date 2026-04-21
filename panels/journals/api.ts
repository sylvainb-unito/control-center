import { fail } from '@cc/server/envelope';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', (c) => c.json(fail('NOT_IMPLEMENTED', 'journals API coming in Task 4'), 501));
api.get('/:tier/:id', (c) =>
  c.json(fail('NOT_IMPLEMENTED', 'journals body API coming in Task 4'), 501),
);
