import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../logger';

// ---- Types ------------------------------------------------------------

export type AiNewsCategory = 'tool' | 'model' | 'protocol' | 'research' | 'community';

export const CATEGORY_VALUES: readonly AiNewsCategory[] = [
  'tool',
  'model',
  'protocol',
  'research',
  'community',
];

export type AiNewsItem = {
  id: string;
  title: string;
  oneLineSummary: string;
  url: string;
  category: AiNewsCategory;
  starred: boolean;
};

export type AiNewsDigest = {
  date: string;
  runAt: string;
  summary: string;
  items: AiNewsItem[];
};

export type AiNewsState = {
  isRunning: boolean;
  lastRunAt?: string;
  lastError?: string;
};

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const ITEM_ID_REGEX = /^[A-Za-z0-9-]+$/;

// ---- Errors -----------------------------------------------------------

export class DigestNotFoundError extends Error {
  readonly code = 'DIGEST_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'DigestNotFoundError';
  }
}

export class DigestReadError extends Error {
  readonly code = 'READ_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'DigestReadError';
  }
}

export class ItemNotFoundError extends Error {
  readonly code = 'ITEM_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'ItemNotFoundError';
  }
}

// ---- Paths ------------------------------------------------------------

export type DirDeps = { home?: string };

function aiNewsRoot(home: string): string {
  return path.join(home, '.claude', 'ai-news');
}

function digestsDir(home: string): string {
  return path.join(aiNewsRoot(home), 'digests');
}

function digestPath(home: string, date: string): string {
  return path.join(digestsDir(home), `${date}.json`);
}

function statePath(home: string): string {
  return path.join(aiNewsRoot(home), 'state.json');
}

const FILENAME_REGEX = /^(\d{4}-\d{2}-\d{2})\.json$/;

// ---- listDigests ------------------------------------------------------

export async function listDigests(deps: DirDeps = {}): Promise<string[]> {
  const home = deps.home ?? os.homedir();
  const dir = digestsDir(home);
  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') return [];
    throw err;
  }
  const dates: string[] = [];
  for (const name of files) {
    const m = FILENAME_REGEX.exec(name);
    if (m?.[1]) dates.push(m[1]);
  }
  dates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  return dates;
}

// ---- readDigest -------------------------------------------------------

export async function readDigest(date: string, deps: DirDeps = {}): Promise<AiNewsDigest> {
  const home = deps.home ?? os.homedir();
  let raw: string;
  try {
    raw = await fs.promises.readFile(digestPath(home, date), 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') throw new DigestNotFoundError(`digest not found: ${date}`);
    const msg = err instanceof Error ? err.message : String(err);
    throw new DigestReadError(msg.slice(0, 200));
  }
  try {
    return JSON.parse(raw) as AiNewsDigest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DigestReadError(`invalid digest JSON: ${msg.slice(0, 200)}`);
  }
}

// ---- writeDigest (atomic) --------------------------------------------

export async function writeDigest(digest: AiNewsDigest, deps: DirDeps = {}): Promise<void> {
  const home = deps.home ?? os.homedir();
  const dir = digestsDir(home);
  await fs.promises.mkdir(dir, { recursive: true });
  const final = digestPath(home, digest.date);
  const tmp = `${final}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(digest, null, 2), 'utf8');
  await fs.promises.rename(tmp, final);
}

// ---- toggleStar -------------------------------------------------------

export async function toggleStar(
  date: string,
  id: string,
  starred: boolean,
  deps: DirDeps = {},
): Promise<{ starred: boolean }> {
  const digest = await readDigest(date, deps);
  const item = digest.items.find((it) => it.id === id);
  if (!item) throw new ItemNotFoundError(`item not found: ${id}`);
  item.starred = starred;
  await writeDigest(digest, deps);
  return { starred };
}

// ---- pruneOldDigests --------------------------------------------------

export async function pruneOldDigests(
  now: Date,
  retainDays: number,
  deps: DirDeps = {},
): Promise<void> {
  const home = deps.home ?? os.homedir();
  const cutoff = now.getTime() - retainDays * 24 * 60 * 60 * 1000;
  const dates = await listDigests(deps);
  for (const date of dates) {
    const ts = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(ts)) continue;
    if (ts >= cutoff) continue;
    try {
      const digest = await readDigest(date, deps);
      const hasStarred = digest.items.some((it) => it.starred === true);
      if (hasStarred) continue;
      await fs.promises.unlink(digestPath(home, date));
    } catch (err) {
      // swallow per-file errors so one broken file doesn't abort the sweep
      logger.warn(
        { date, err: (err as Error).message },
        'ai-news prune: skipping unreadable digest',
      );
    }
  }
}

// ---- readState / writeState ------------------------------------------

export async function readState(deps: DirDeps = {}): Promise<AiNewsState> {
  const home = deps.home ?? os.homedir();
  let raw: string;
  try {
    raw = await fs.promises.readFile(statePath(home), 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') return { isRunning: false };
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AiNewsState>;
    return {
      ...parsed,
      isRunning: Boolean(parsed.isRunning),
    };
  } catch {
    // corrupt state file — treat as fresh
    return { isRunning: false };
  }
}

export async function writeState(state: AiNewsState, deps: DirDeps = {}): Promise<void> {
  const home = deps.home ?? os.homedir();
  await fs.promises.mkdir(aiNewsRoot(home), { recursive: true });
  await fs.promises.writeFile(statePath(home), JSON.stringify(state, null, 2), 'utf8');
}

// ---- listStarred ------------------------------------------------------

export async function listStarred(
  deps: DirDeps = {},
): Promise<(AiNewsItem & { digestDate: string })[]> {
  const dates = await listDigests(deps);
  const out: (AiNewsItem & { digestDate: string })[] = [];
  for (const date of dates) {
    let digest: AiNewsDigest;
    try {
      digest = await readDigest(date, deps);
    } catch (err) {
      logger.warn(
        { date, err: (err as Error).message },
        'ai-news listStarred: skipping unreadable digest',
      );
      continue;
    }
    for (const item of digest.items) {
      if (item.starred === true) {
        out.push({ ...item, digestDate: date });
      }
    }
  }
  return out;
}
