import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pkg from '../package.json' with { type: 'json' };
import { fail, ok } from './envelope';
import { logger } from './logger';
import { registerRoutes } from './routes';

const startedAt = new Date().toISOString();
const app = new Hono();

app.get('/api/health', (c) =>
  c.json(
    ok({
      uptime: Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
      version: pkg.version,
      startedAt,
    }),
  ),
);

registerRoutes(app);

app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled');
  return c.json(fail('INTERNAL', 'Internal error'), 500);
});

const port = Number(process.env.PORT ?? 7778);
const hostname = process.env.BIND_HOST ?? '127.0.0.1';

serve({ fetch: app.fetch, port, hostname }, (info) => {
  logger.info({ port: info.port, hostname }, 'server ready');
});
