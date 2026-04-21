import { execFile as execFileCb } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { logger } from '../logger';
import { type Globber, defaultGlobber } from './fs-helpers';

export type { Globber };

const execFile = promisify(execFileCb);

export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export type Worktree = {
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastCommitAt: string;
  mergedToMain: boolean;
  ageDays: number;
};

export type Repo = { name: string; path: string; worktrees: Worktree[] };

const defaultRunner: Runner = async (cmd, args) => {
  const { stdout, stderr } = await execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 });
  return { stdout, stderr };
};

type Deps = {
  runner?: Runner;
  globber?: Globber;
  now?: () => number;
  home?: string;
};

async function mergedBranches(runner: Runner, repoPath: string): Promise<Set<string>> {
  for (const base of ['main', 'master']) {
    try {
      const { stdout } = await runner('git', [
        '-C',
        repoPath,
        'branch',
        '--merged',
        base,
        '--format=%(refname:short)',
      ]);
      return new Set(
        stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } catch (err) {
      logger.warn(
        { repoPath, base, err: (err as Error)?.message },
        'git branch --merged failed; trying next base',
      );
    }
  }
  return new Set();
}

export async function listWorktrees(deps: Deps = {}): Promise<Repo[]> {
  const runner = deps.runner ?? defaultRunner;
  const globber = deps.globber ?? defaultGlobber;
  const now = deps.now ?? (() => Date.now());
  const home = deps.home ?? os.homedir();

  const pattern = path.join(home, 'Workspace', '*', '.worktrees', '*');
  const paths = await globber(pattern);

  type RepoWithMerged = Repo & { __merged: Set<string> };
  const repos = new Map<string, RepoWithMerged>();

  for (const wtPath of paths) {
    const repoPath = path.resolve(wtPath, '..', '..');
    const repoName = path.basename(repoPath);

    const [branch, head, status, lastCommit] = await Promise.all([
      runner('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD'])
        .then((r) => r.stdout.trim())
        .catch((err: unknown) => {
          logger.warn(
            { wtPath, cmd: 'rev-parse --abbrev-ref HEAD', err: (err as Error)?.message },
            'git call failed',
          );
          return '';
        }),
      runner('git', ['-C', wtPath, 'rev-parse', '--short', 'HEAD'])
        .then((r) => r.stdout.trim())
        .catch((err: unknown) => {
          logger.warn(
            { wtPath, cmd: 'rev-parse --short HEAD', err: (err as Error)?.message },
            'git call failed',
          );
          return '';
        }),
      runner('git', ['-C', wtPath, 'status', '--porcelain'])
        .then((r) => r.stdout)
        .catch((err: unknown) => {
          logger.warn(
            { wtPath, cmd: 'status --porcelain', err: (err as Error)?.message },
            'git call failed',
          );
          return '';
        }),
      runner('git', ['-C', wtPath, 'log', '-1', '--format=%cI'])
        .then((r) => r.stdout.trim())
        .catch((err: unknown) => {
          logger.warn(
            { wtPath, cmd: 'log -1 --format=%cI', err: (err as Error)?.message },
            'git call failed',
          );
          return '';
        }),
    ]);

    const aheadBehindResult = await runner('git', [
      '-C',
      wtPath,
      'rev-list',
      '--left-right',
      '--count',
      '@{upstream}...HEAD',
    ])
      .then((r) => ({ ok: true as const, value: r.stdout.trim() }))
      .catch((err: unknown) => {
        logger.warn(
          { wtPath, cmd: 'rev-list --left-right', err: (err as Error)?.message },
          'git call failed',
        );
        return { ok: false as const };
      });

    let ahead = 0;
    let behind = 0;
    const hasUpstream = aheadBehindResult.ok;
    if (aheadBehindResult.ok) {
      const [behindStr, aheadStr] = aheadBehindResult.value.split(/\s+/);
      behind = Number.parseInt(behindStr ?? '0', 10) || 0;
      ahead = Number.parseInt(aheadStr ?? '0', 10) || 0;
    }

    // Use Math.round (not floor): "4d 14h ago" reads as "5 days old" to humans.
    // Trade-off: a 13-hour-old commit rounds to 1 day, while 11-hour-old rounds to 0.
    const ageDays = lastCommit ? Math.round((now() - Date.parse(lastCommit)) / 86_400_000) : 0;

    let repo = repos.get(repoPath);
    if (!repo) {
      const merged = await mergedBranches(runner, repoPath);
      repo = { name: repoName, path: repoPath, worktrees: [], __merged: merged };
      repos.set(repoPath, repo);
    }

    repo.worktrees.push({
      path: wtPath,
      branch,
      head,
      dirty: status.trim().length > 0,
      ahead,
      behind,
      hasUpstream,
      lastCommitAt: lastCommit,
      mergedToMain: repo.__merged.has(branch),
      ageDays,
    });
  }

  return [...repos.values()].map(({ __merged: _ignored, ...r }) => r);
}

export class GitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'GitError';
  }
}

export type RemoveWorktreeResult = {
  branchDeleted: string | null;
  branchDeleteError?: string;
};

export async function removeWorktree(
  worktreePath: string,
  opts: { force: boolean; deleteBranch?: boolean; runner?: Runner },
): Promise<RemoveWorktreeResult> {
  const runner = opts.runner ?? defaultRunner;
  const repoPath = path.resolve(worktreePath, '..', '..');

  // Resolve branch name BEFORE removing the folder — git can't read a gone worktree.
  let branch: string | null = null;
  if (opts.deleteBranch) {
    try {
      const { stdout } = await runner('git', [
        '-C',
        worktreePath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ]);
      const name = stdout.trim();
      branch = name && name !== 'HEAD' ? name : null;
    } catch (err) {
      logger.warn(
        { worktreePath, err: (err as Error)?.message },
        'branch resolve failed; will skip branch delete',
      );
      branch = null;
    }
  }

  const { stdout: status } = await runner('git', ['-C', worktreePath, 'status', '--porcelain']);
  if (status.trim().length > 0 && !opts.force) {
    throw new GitError('DIRTY_WORKTREE', 'worktree has uncommitted changes');
  }

  const args = ['-C', repoPath, 'worktree', 'remove'];
  if (opts.force) args.push('--force');
  args.push(worktreePath);
  try {
    await runner('git', args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ worktreePath, repoPath, err: msg }, 'git worktree remove failed');
    throw new GitError('REMOVE_FAILED', msg.slice(0, 200));
  }

  if (!branch) return { branchDeleted: null };

  try {
    await runner('git', ['-C', repoPath, 'branch', '-D', branch]);
    return { branchDeleted: branch };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ branch, repoPath, err: msg }, 'git branch -D failed after worktree remove');
    return { branchDeleted: null, branchDeleteError: msg.slice(0, 200) };
  }
}
