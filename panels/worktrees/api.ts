import { fail, ok } from '@cc/server/envelope';
import { GitError, listWorktrees, removeWorktree } from '@cc/server/lib/git';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', async (c) => {
  const repos = await listWorktrees();
  return c.json(ok({ repos }));
});

api.delete('/', async (c) => {
  const body = await c.req.json<{ path: string; force?: boolean }>();
  if (!body?.path) return c.json(fail('BAD_REQUEST', 'path required'), 400);
  try {
    await removeWorktree(body.path, { force: body.force === true });
    return c.json(ok({ removed: body.path }));
  } catch (err) {
    if (err instanceof GitError) {
      const status = err.code === 'DIRTY_WORKTREE' ? 409 : 500;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});
