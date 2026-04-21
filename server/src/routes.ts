import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { api as sessionsApi } from '../../panels/claude-sessions/api';
import { api as journalsApi } from '../../panels/journals/api';
import { api as prsApi } from '../../panels/pull-requests/api';
import { api as shortcutsApi } from '../../panels/shortcuts/api';
import { api as worktreesApi } from '../../panels/worktrees/api';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGOS = path.resolve(HERE, '..', '..', 'config', 'logos');

export function registerRoutes(app: Hono): void {
  app.route('/api/worktrees', worktreesApi);
  app.route('/api/pull-requests', prsApi);
  app.route('/api/shortcuts', shortcutsApi);
  app.route('/api/claude-sessions', sessionsApi);
  app.route('/api/journals', journalsApi);
  app.use(
    '/logos/*',
    serveStatic({
      root: LOGOS,
      rewriteRequestPath: (p) => p.replace(/^\/logos/, ''),
    }),
  );
}
