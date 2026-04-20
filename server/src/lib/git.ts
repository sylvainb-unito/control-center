import { execFile as execFileCb } from 'node:child_process';
import { glob as nativeGlob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

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
    } catch {
      // try next base
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

    const [branch, head, status, aheadBehind, lastCommit] = await Promise.all([
      runner('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD'])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
      runner('git', ['-C', wtPath, 'rev-parse', '--short', 'HEAD'])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
      runner('git', ['-C', wtPath, 'status', '--porcelain'])
        .then((r) => r.stdout)
        .catch(() => ''),
      runner('git', ['-C', wtPath, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
        .then((r) => r.stdout.trim())
        .catch(() => '0\t0'),
      runner('git', ['-C', wtPath, 'log', '-1', '--format=%cI'])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
    ]);

    const [behindStr, aheadStr] = aheadBehind.split(/\s+/);
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
      ahead: Number.parseInt(aheadStr ?? '0', 10) || 0,
      behind: Number.parseInt(behindStr ?? '0', 10) || 0,
      lastCommitAt: lastCommit,
      mergedToMain: repo.__merged.has(branch),
      ageDays,
    });
  }

  return [...repos.values()].map(({ __merged: _ignored, ...r }) => r);
}
