import type { ExecFileException } from 'node:child_process';
import { describe, expect, test } from 'vitest';

type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

describe('listWorktrees', () => {
  test('parses glob result and runs per-worktree git commands', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner: Runner = async (cmd, args) => {
      calls.push({ cmd, args });
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /Users/u/Workspace/proj/.worktrees/feat-x\nbranch refs/heads/feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'abc1234\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t3\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-15T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) return { stdout: 'feat/x\nmain\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    const globber = async () => ['/Users/u/Workspace/proj/.worktrees/feat-x'];

    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => new Date('2026-04-20T00:00:00Z').getTime(),
    });

    expect(result).toEqual([
      {
        name: 'proj',
        path: '/Users/u/Workspace/proj',
        worktrees: [
          {
            path: '/Users/u/Workspace/proj/.worktrees/feat-x',
            branch: 'feat/x',
            head: 'abc1234',
            dirty: false,
            ahead: 3,
            behind: 0,
            hasUpstream: true,
            lastCommitAt: '2026-04-15T10:00:00Z',
            mergedToMain: true,
            ageDays: 5,
            orphan: false,
          },
        ],
      },
    ]);
    expect(calls.some((c) => c.args[0] === '-C' && c.args.includes('rev-parse'))).toBe(true);
  });

  test('falls back to master when main missing', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /w/proj/.worktrees/feat-x\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'aaa\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t0\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged main')) {
        const err: ExecFileException = new Error('fatal') as ExecFileException;
        err.code = 128;
        throw err;
      }
      if (joined.includes('branch --merged master')) return { stdout: 'feat/x\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const globber = async () => ['/w/proj/.worktrees/feat-x'];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => Date.parse('2026-04-20T00:00:00Z'),
    });
    expect(result[0]?.worktrees[0]?.mergedToMain).toBe(true);
    expect(result[0]?.worktrees[0]?.hasUpstream).toBe(true);
  });

  test('mergedToMain is false when neither main nor master exists', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /w/proj/.worktrees/feat-x\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'bbb\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t0\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) {
        const err: ExecFileException = new Error('fatal') as ExecFileException;
        err.code = 128;
        throw err;
      }
      return { stdout: '', stderr: '' };
    };
    const globber = async () => ['/w/proj/.worktrees/feat-x'];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => Date.parse('2026-04-20T00:00:00Z'),
    });
    expect(result[0]?.worktrees[0]?.mergedToMain).toBe(false);
  });

  test('dirty worktree sets dirty: true', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /w/proj/.worktrees/feat-x\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'ccc\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: ' M foo.txt\n', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t0\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const globber = async () => ['/w/proj/.worktrees/feat-x'];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => Date.parse('2026-04-20T00:00:00Z'),
    });
    expect(result[0]?.worktrees[0]?.dirty).toBe(true);
  });

  test('hasUpstream is false when rev-list fails', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /w/proj/.worktrees/feat-x\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'ddd\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) {
        throw new Error('no upstream configured');
      }
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const globber = async () => ['/w/proj/.worktrees/feat-x'];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => Date.parse('2026-04-20T00:00:00Z'),
    });
    const wt = result[0]?.worktrees[0];
    expect(wt?.hasUpstream).toBe(false);
    expect(wt?.ahead).toBe(0);
    expect(wt?.behind).toBe(0);
  });

  test('empty glob returns empty repo list', async () => {
    const runner: Runner = async () => ({ stdout: '', stderr: '' });
    const globber = async () => [];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({ runner, globber, now: () => 0 });
    expect(result).toEqual([]);
  });

  test('orphan detection: path not in worktree list gets orphan: true with zeroed fields', async () => {
    // glob returns two paths; porcelain only lists one of them
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /w/proj/.worktrees/registered\nbranch refs/heads/feat/r\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/r\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'abc\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t0\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const globber = async () => [
      '/w/proj/.worktrees/registered',
      '/w/proj/.worktrees/orphan',
    ];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => Date.parse('2026-04-20T00:00:00Z'),
    });

    const worktrees = result[0]?.worktrees ?? [];
    const registered = worktrees.find((wt) => wt.path.endsWith('registered'));
    const orphan = worktrees.find((wt) => wt.path.endsWith('orphan'));

    expect(registered).toMatchObject({ orphan: false, branch: 'feat/r', head: 'abc' });
    expect(orphan).toMatchObject({
      orphan: true,
      branch: '',
      head: '',
      dirty: false,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      lastCommitAt: '',
      mergedToMain: false,
    });
  });

  test('non-orphan path has orphan: false (field present on all entries)', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list --porcelain'))
        return { stdout: 'worktree /w/proj/.worktrees/feat-x\n', stderr: '' };
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'abc\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t0\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI'))
        return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const globber = async () => ['/w/proj/.worktrees/feat-x'];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({
      runner,
      globber,
      now: () => Date.parse('2026-04-20T00:00:00Z'),
    });
    expect(result[0]?.worktrees[0]).toHaveProperty('orphan', false);
  });
});

describe('removeWorktree', () => {
  test('refuses dirty tree without force', async () => {
    const runner: Runner = async (_cmd, args) => {
      if (args.includes('status')) return { stdout: ' M foo\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    await expect(
      removeWorktree('/w/proj/.worktrees/x', { force: false, runner }),
    ).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' });
  });

  test('runs git worktree remove with --force when forced', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: ' M foo\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    await removeWorktree('/w/proj/.worktrees/x', { force: true, runner });
    const removeCall = calls.find((a) => a.includes('remove'));
    expect(removeCall).toEqual([
      '-C',
      '/w/proj',
      'worktree',
      'remove',
      '--force',
      '/w/proj/.worktrees/x',
    ]);
  });

  test('runs remove without --force when clean', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    await removeWorktree('/w/proj/.worktrees/x', { force: false, runner });
    const removeCall = calls.find((a) => a.includes('remove'));
    expect(removeCall).toEqual(['-C', '/w/proj', 'worktree', 'remove', '/w/proj/.worktrees/x']);
  });

  test('deleteBranch: resolves branch name then runs branch -D after remove', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: '', stderr: '' };
      if (args.join(' ').includes('rev-parse --abbrev-ref'))
        return { stdout: 'feat/x\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/x', {
      force: false,
      deleteBranch: true,
      runner,
    });
    expect(result).toEqual({ branchDeleted: 'feat/x' });

    // Order matters: rev-parse → status → worktree remove → branch -D
    const cmdNames = calls.map((a) => a.filter((s) => !s.startsWith('/')).join(' '));
    const revParseIdx = cmdNames.findIndex((s) => s.includes('rev-parse --abbrev-ref'));
    const removeIdx = cmdNames.findIndex((s) => s.includes('worktree remove'));
    const branchDelIdx = cmdNames.findIndex((s) => s.includes('branch -D'));
    expect(revParseIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThan(revParseIdx);
    expect(branchDelIdx).toBeGreaterThan(removeIdx);

    const branchCall = calls.find((a) => a.includes('-D'));
    expect(branchCall).toEqual(['-C', '/w/proj', 'branch', '-D', 'feat/x']);
  });

  test('deleteBranch: returns branchDeleteError when branch -D fails (no throw)', async () => {
    const runner: Runner = async (_cmd, args) => {
      if (args.includes('status')) return { stdout: '', stderr: '' };
      if (args.join(' ').includes('rev-parse --abbrev-ref'))
        return { stdout: 'feat/x\n', stderr: '' };
      if (args.includes('-D')) throw new Error('branch not found');
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/x', {
      force: false,
      deleteBranch: true,
      runner,
    });
    expect(result.branchDeleted).toBeNull();
    expect(result.branchDeleteError).toMatch(/branch not found/);
  });

  test('deleteBranch: skips branch -D when HEAD is detached', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: '', stderr: '' };
      if (args.join(' ').includes('rev-parse --abbrev-ref'))
        return { stdout: 'HEAD\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/x', {
      force: false,
      deleteBranch: true,
      runner,
    });
    expect(result).toEqual({ branchDeleted: null });
    expect(calls.some((a) => a.includes('-D'))).toBe(false);
  });

  test('deleteBranch: force + deleteBranch runs all three git calls', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: ' M f\n', stderr: '' };
      if (args.join(' ').includes('rev-parse --abbrev-ref'))
        return { stdout: 'feat/x\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/x', {
      force: true,
      deleteBranch: true,
      runner,
    });
    expect(result).toEqual({ branchDeleted: 'feat/x' });
    expect(calls.find((a) => a.includes('remove'))).toEqual([
      '-C',
      '/w/proj',
      'worktree',
      'remove',
      '--force',
      '/w/proj/.worktrees/x',
    ]);
    expect(calls.find((a) => a.includes('-D'))).toEqual([
      '-C',
      '/w/proj',
      'branch',
      '-D',
      'feat/x',
    ]);
  });

  test('deleteBranch: default false preserves legacy return shape', async () => {
    const runner: Runner = async (_cmd, args) => {
      if (args.includes('status')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/x', {
      force: false,
      deleteBranch: false,
      runner,
    });
    expect(result).toEqual({ branchDeleted: null });
  });

  test('deleteBranch: rev-parse failure skips branch delete but still removes folder', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.join(' ').includes('rev-parse --abbrev-ref'))
        throw new Error('not a git repository');
      if (args.includes('status')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/x', {
      force: false,
      deleteBranch: true,
      runner,
    });
    expect(result).toEqual({ branchDeleted: null });
    expect(calls.some((a) => a.includes('remove'))).toBe(true);
    expect(calls.some((a) => a.includes('-D'))).toBe(false);
  });

  test('orphan: uses injected rm, never calls git status or worktree remove', async () => {
    const gitCalls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      gitCalls.push(args);
      return { stdout: '', stderr: '' };
    };
    let rmCalledWith: string | null = null;
    const rm = async (p: string) => {
      rmCalledWith = p;
    };
    const { removeWorktree } = await import('./git');
    const result = await removeWorktree('/w/proj/.worktrees/orphan', {
      force: false,
      orphan: true,
      runner,
      rm,
    });
    expect(result).toEqual({ branchDeleted: null });
    expect(rmCalledWith).toBe('/w/proj/.worktrees/orphan');
    expect(gitCalls.some((a) => a.includes('status'))).toBe(false);
    expect(gitCalls.some((a) => a.includes('remove'))).toBe(false);
  });

  test('orphan: rm failure throws REMOVE_FAILED', async () => {
    const runner: Runner = async () => ({ stdout: '', stderr: '' });
    const rm = async (_p: string) => {
      throw new Error('permission denied');
    };
    const { removeWorktree } = await import('./git');
    await expect(
      removeWorktree('/w/proj/.worktrees/orphan', { force: false, orphan: true, runner, rm }),
    ).rejects.toMatchObject({ code: 'REMOVE_FAILED' });
  });
});
