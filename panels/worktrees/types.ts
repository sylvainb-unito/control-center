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
  orphan: boolean;
};

export type Repo = { name: string; path: string; worktrees: Worktree[] };

export type ListResponse = { repos: Repo[] };
