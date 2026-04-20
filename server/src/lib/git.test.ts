import type { ExecFileException } from 'node:child_process';
import { describe, expect, test } from 'vitest';

type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

describe('listWorktrees', () => {
  test('parses glob result and runs per-worktree git commands', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner: Runner = async (cmd, args) => {
      calls.push({ cmd, args });
      const joined = args.join(' ');
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
            lastCommitAt: '2026-04-15T10:00:00Z',
            mergedToMain: true,
            ageDays: 5,
          },
        ],
      },
    ]);
    expect(calls.some((c) => c.args[0] === '-C' && c.args.includes('rev-parse'))).toBe(true);
  });

  test('falls back to master when main missing', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
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
  });
});
