import { execFile as execFileCb } from 'node:child_process';
import { glob as nativeGlob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { logger } from '../logger';

const execFile = promisify(execFileCb);

export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export type Globber = (pattern: string) => Promise<string[]>;

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

const defaultGlobber: Globber = async (pattern) => {
  const entries: string[] = [];
  for await (const entry of nativeGlob(pattern)) entries.push(entry as string);
  return entries;
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
