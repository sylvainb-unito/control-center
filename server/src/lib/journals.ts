import fs from 'node:fs';
import { glob as nativeGlob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import { logger } from '../logger';

export type Tier = 'daily' | 'weekly' | 'monthly';

export type JournalSummary = {
  id: string;
  tier: Tier;
  date: string;
  repos: string[];
  sessions: number | null;
  period?: string;
};

export type ListResponse = {
  daily: JournalSummary[];
  weekly: JournalSummary[];
  monthly: JournalSummary[];
};

export type ListDeps = {
  home?: string;
  globber?: (pattern: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number; size: number }>;
  readFile?: (p: string) => Promise<string>;
  clearCache?: boolean;
};

type CacheEntry = { mtime: number; size: number; parsed: JournalSummary };
const cache = new Map<string, CacheEntry>();

const TIERS: Tier[] = ['daily', 'weekly', 'monthly'];

const defaultGlobber = async (pattern: string): Promise<string[]> => {
  const out: string[] = [];
  for await (const entry of nativeGlob(pattern)) out.push(entry as string);
  return out;
};

const defaultStat = async (p: string): Promise<{ mtimeMs: number; size: number }> => {
  const s = await fs.promises.stat(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
};

const defaultReadFile = async (p: string): Promise<string> => fs.promises.readFile(p, 'utf8');

function coerceRepos(value: unknown): string[] {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  return [];
}

function coerceSessions(data: Record<string, unknown>): number | null {
  // Daily uses `session` (sequence number); weekly/monthly use `sessions` (count).
  if (typeof data.session === 'number') return data.session;
  if (typeof data.sessions === 'number') return data.sessions;
  return null;
}

function buildSummary(filePath: string, tier: Tier, raw: string): JournalSummary {
  const id = path.basename(filePath, '.md');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const summary: JournalSummary = {
    id,
    tier,
    date: typeof data.date === 'string' ? data.date : id,
    repos: coerceRepos(data.repos),
    sessions: coerceSessions(data),
  };

  if (Array.isArray(data.repos) === false && data.repos !== undefined) {
    logger.warn({ tier, id }, 'journal repos frontmatter is not an array; coerced to []');
  }

  if (typeof data.period === 'string') {
    summary.period = data.period;
  }
  return summary;
}

export async function listJournals(deps: ListDeps = {}): Promise<ListResponse> {
  if (deps.clearCache) cache.clear();
  const home = deps.home ?? os.homedir();
  const globber = deps.globber ?? defaultGlobber;
  const stat = deps.stat ?? defaultStat;
  const readFile = deps.readFile ?? defaultReadFile;

  const surviving = new Set<string>();
  const result: ListResponse = { daily: [], weekly: [], monthly: [] };

  for (const tier of TIERS) {
    const pattern = path.join(home, '.claude', 'journals', tier, '*.md');
    const files = await globber(pattern);

    for (const filePath of files) {
      const st = await stat(filePath).catch((err) => {
        logger.warn({ filePath, err: (err as Error)?.message }, 'journals stat failed; skipping');
        return null;
      });
      if (!st) continue;
      surviving.add(filePath);

      let entry = cache.get(filePath);
      if (!entry || entry.mtime !== st.mtimeMs || entry.size !== st.size) {
        try {
          const raw = await readFile(filePath);
          const parsed = buildSummary(filePath, tier, raw);
          entry = { mtime: st.mtimeMs, size: st.size, parsed };
          cache.set(filePath, entry);
        } catch (err) {
          logger.warn(
            { filePath, err: (err as Error)?.message },
            'journals parse failed; skipping',
          );
          continue;
        }
      }

      result[tier].push(entry.parsed);
    }

    result[tier].sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
  }

  for (const key of [...cache.keys()]) {
    if (!surviving.has(key)) cache.delete(key);
  }

  return result;
}
