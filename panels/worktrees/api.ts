import { fail, ok } from '@cc/server/envelope';
import { GitError, listWorktrees, removeWorktree } from '@cc/server/lib/git';
import { Hono } from 'hono';

export const api = new Hono();

api.get('/', async (c) => {
  const repos = await listWorktrees();
  return c.json(ok({ repos }));
});

api.delete('/', async (c) => {
  const body = await c.req.json<{ path: string; force?: boolean; deleteBranch?: boolean }>();
  if (!body?.path) return c.json(fail('BAD_REQUEST', 'path required'), 400);
  try {
    const result = await removeWorktree(body.path, {
      force: body.force === true,
      deleteBranch: body.deleteBranch === true,
    });
    const data: {
      removed: string;
      branchDeleted: string | null;
      branchDeleteError?: string;
    } = {
      removed: body.path,
      branchDeleted: result.branchDeleted,
    };
    if (result.branchDeleteError) data.branchDeleteError = result.branchDeleteError;
    return c.json(ok(data));
  } catch (err) {
    if (err instanceof GitError) {
      const status = err.code === 'DIRTY_WORKTREE' ? 409 : 500;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});
