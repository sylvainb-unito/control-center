import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { logger } from '../logger';

/**
 * Hidden-session list — sessionIds the user has dismissed from the Claude
 * Sessions panel. Stored as JSON so it's trivially inspectable + portable.
 *
 * Design: hide by sessionId (not by project/cwd) so that starting a fresh
 * session at a previously-hidden path doesn't inherit the hidden state.
 */

type FileShape = { hidden: string[] };

export type HiddenStore = {
  list(): Promise<Set<string>>;
  add(ids: string[]): Promise<Set<string>>;
  remove(ids: string[]): Promise<Set<string>>;
};

export type StoreDeps = {
  home?: string;
  readFile?: typeof fs.readFile;
  writeFile?: typeof fs.writeFile;
  mkdir?: typeof fs.mkdir;
};

function storePath(home: string): string {
  return path.join(home, '.claude', 'sessions', 'hidden.json');
}

async function readStore(p: string, readFile: typeof fs.readFile): Promise<Set<string>> {
  try {
    const raw = await readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    const ids = Array.isArray(parsed?.hidden)
      ? parsed.hidden.filter((x) => typeof x === 'string')
      : [];
    return new Set(ids);
  } catch (err) {
    // Missing file = empty set. Any other read/parse failure gets logged but doesn't throw.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn({ path: p, err: (err as Error)?.message }, 'failed to read hidden-sessions file');
    }
    return new Set();
  }
}

async function writeStore(
  p: string,
  set: Set<string>,
  writeFile: typeof fs.writeFile,
  mkdir: typeof fs.mkdir,
): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  const payload: FileShape = { hidden: [...set].sort() };
  await writeFile(p, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function makeHiddenStore(deps: StoreDeps = {}): HiddenStore {
  const home = deps.home ?? os.homedir();
  const readFile = deps.readFile ?? fs.readFile;
  const writeFile = deps.writeFile ?? fs.writeFile;
  const mkdir = deps.mkdir ?? fs.mkdir;
  const p = storePath(home);

  return {
    async list() {
      return readStore(p, readFile);
    },
    async add(ids) {
      const current = await readStore(p, readFile);
      for (const id of ids) current.add(id);
      await writeStore(p, current, writeFile, mkdir);
      return current;
    },
    async remove(ids) {
      const current = await readStore(p, readFile);
      for (const id of ids) current.delete(id);
      await writeStore(p, current, writeFile, mkdir);
      return current;
    },
  };
}
