import fs from 'node:fs';
import { glob as nativeGlob } from 'node:fs/promises';

export type Globber = (pattern: string) => Promise<string[]>;

export type Statter = (p: string) => Promise<{ mtimeMs: number; size: number }>;

export const defaultGlobber: Globber = async (pattern) => {
  const out: string[] = [];
  for await (const entry of nativeGlob(pattern)) out.push(entry as string);
  return out;
};

export const defaultStat: Statter = async (p) => {
  const s = await fs.promises.stat(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
};
