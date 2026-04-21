import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { setPricing } from '../../panels/claude-sessions/api';
import pkg from '../package.json' with { type: 'json' };
import { fail, ok } from './envelope';
import { processPending } from './lib/braindump-processor';
import { loadPricing } from './lib/sessions';
import { logger } from './logger';
import { registerRoutes } from './routes';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pricingPath = path.resolve(HERE, '..', '..', 'config', 'model-pricing.json');
setPricing(loadPricing(pricingPath));

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const app = new Hono();

app.get('/api/health', (c) =>
  c.json(
    ok({
      uptime: Math.floor((Date.now() - startedAtMs) / 1000),
      version: pkg.version,
      startedAt,
    }),
  ),
);

registerRoutes(app);

const ONE_HOUR_MS = 60 * 60 * 1000;
void processPending().catch((err) =>
  logger.warn({ err: (err as Error).message }, 'braindump boot tick failed'),
);
setInterval(() => {
  void processPending().catch((err) =>
    logger.warn({ err: (err as Error).message }, 'braindump hourly tick failed'),
  );
}, ONE_HOUR_MS);

const WEB_DIST = path.resolve(HERE, '..', '..', 'web', 'dist');
const serveStaticFiles = process.env.SERVE_STATIC !== 'false';

if (serveStaticFiles) {
  app.use('/*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ path: path.join(WEB_DIST, 'index.html') }));
}

app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled');
  return c.json(fail('INTERNAL', 'Internal error'), 500);
});

const port = Number(process.env.PORT ?? 7777);
const hostname = process.env.BIND_HOST ?? '127.0.0.1';

serve({ fetch: app.fetch, port, hostname }, (info) => {
  logger.info({ port: info.port, hostname, serveStatic: serveStaticFiles }, 'server ready');
});
