import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/git', () => ({
  listWorktrees: vi.fn(async () => [{ name: 'proj', path: '/p', worktrees: [] }]),
  removeWorktree: vi.fn(async () => {}),
  GitError: class GitError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

describe('worktrees api', () => {
  test('GET / returns envelope of repos', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: { repos: [{ name: 'proj', path: '/p', worktrees: [] }] },
    });
  });

  test('DELETE / with dirty returns DIRTY_WORKTREE', async () => {
    const git = await import('@cc/server/lib/git');
    // Reconstruct a real instance of our mocked GitError (from the vi.mock above)
    const MockGitError = git.GitError as unknown as new (code: string, message: string) => Error;
    const dirtyErr = new MockGitError('DIRTY_WORKTREE', 'worktree has uncommitted changes');
    (git.removeWorktree as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(dirtyErr);
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/p/.worktrees/x', force: false }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: 'DIRTY_WORKTREE' },
    });
  });

  test('DELETE / success returns removed path', async () => {
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/p/.worktrees/x', force: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: { removed: '/p/.worktrees/x' },
    });
  });
});
