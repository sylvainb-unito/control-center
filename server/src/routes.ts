import type { Hono } from 'hono';
import { api as worktreesApi } from '../../panels/worktrees/api';

export function registerRoutes(app: Hono): void {
  app.route('/api/worktrees', worktreesApi);
}
