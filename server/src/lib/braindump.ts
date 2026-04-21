import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import { logger } from '../logger';

// ---- Types ------------------------------------------------------------

export type Category = 'todo' | 'thought' | 'read-later';
export type EntryStatus = 'new' | 'processing' | 'processed' | 'failed';

export type FailureInfo = {
  attempts: number;
  lastError: string;
  lastAttemptAt: string;
};

export type EntrySummary = {
  id: string;
  capturedAt: string;
  status: EntryStatus;
  category?: Category;
  title?: string;
  summary?: string;
  tags?: string[];
  processedAt?: string;
  failure?: FailureInfo;
  /** First ~60 chars of raw body; used by the UI when no processed title exists yet. */
  preview?: string;
};

export type ListResponse = {
  inbox: EntrySummary[];
  processed: EntrySummary[];
};

export type ProcessedFields = {
  category: Category;
  title: string;
  summary: string;
  tags: string[];
  processedAt: string;
};

// ---- ID generation ----------------------------------------------------

export const ID_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[a-z0-9]{4}$/;

export type IdDeps = {
  now?: () => Date;
  randomSuffix?: () => string;
};

const defaultRandomSuffix = (): string => crypto.randomBytes(2).toString('hex');

export function generateId(deps: IdDeps = {}): string {
  const now = deps.now ?? (() => new Date());
  const randomSuffix = deps.randomSuffix ?? defaultRandomSuffix;
  const d = now();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
  return `${date}T${time}-${randomSuffix()}`;
}

// ---- createEntry ------------------------------------------------------

export const MAX_RAW_LEN = 8000;

export type CreateDeps = IdDeps & {
  home?: string;
  mkdir?: (p: string) => Promise<void>;
  writeFile?: (p: string, data: string) => Promise<void>;
};

const defaultMkdir = async (p: string): Promise<void> => {
  await fs.promises.mkdir(p, { recursive: true });
};

const defaultWriteFile = async (p: string, data: string): Promise<void> => {
  await fs.promises.writeFile(p, data, 'utf8');
};

const defaultReadFile = async (p: string): Promise<string> => fs.promises.readFile(p, 'utf8');

function braindumpsDir(home: string): string {
  return path.join(home, '.claude', 'braindumps');
}

function serialize(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, data);
}

export async function createEntry(rawText: string, deps: CreateDeps = {}): Promise<{ id: string }> {
  const trimmed = rawText.replace(/\s+$/u, '');
  if (trimmed.trim().length === 0) {
    throw new Error('braindump entry is empty');
  }
  if (trimmed.length > MAX_RAW_LEN) {
    throw new Error(`braindump entry too long (${trimmed.length} > ${MAX_RAW_LEN})`);
  }
  const home = deps.home ?? os.homedir();
  const mkdir = deps.mkdir ?? defaultMkdir;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const now = deps.now ?? (() => new Date());

  const id = generateId({ now, randomSuffix: deps.randomSuffix });
  const dir = braindumpsDir(home);
  await mkdir(dir);
  const file = path.join(dir, `${id}.md`);
  const front = {
    id,
    capturedAt: now().toISOString(),
    status: 'new' as EntryStatus,
  };
  await writeFile(file, serialize(front, trimmed));
  return { id };
}

// ---- listEntries ------------------------------------------------------

const STATUS_VALUES: EntryStatus[] = ['new', 'processing', 'processed', 'failed'];
export const CATEGORY_VALUES: readonly Category[] = ['todo', 'thought', 'read-later'];

export type ListDeps = {
  home?: string;
  readdir?: (dir: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
};

const defaultReaddir = async (dir: string): Promise<string[]> => {
  return fs.promises.readdir(dir);
};

function coerceTags(v: unknown): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  return [];
}

function coerceTimestamp(v: unknown): string | null {
  // js-yaml parses unquoted ISO timestamps as Date; handle both forms.
  if (typeof v === 'string') return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return null;
}

function coerceFailure(v: unknown): FailureInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const obj = v as Record<string, unknown>;
  if (typeof obj.attempts !== 'number') return undefined;
  if (typeof obj.lastError !== 'string') return undefined;
  const lastAttemptAt = coerceTimestamp(obj.lastAttemptAt);
  if (!lastAttemptAt) return undefined;
  return {
    attempts: obj.attempts,
    lastError: obj.lastError,
    lastAttemptAt,
  };
}

const PREVIEW_LEN = 60;

function buildPreview(body: string): string | undefined {
  const flat = body.replace(/\s+/gu, ' ').trim();
  if (flat.length === 0) return undefined;
  return flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN)}…` : flat;
}

function summaryFromFront(
  filename: string,
  data: Record<string, unknown>,
  body: string,
): EntrySummary | null {
  const id = typeof data.id === 'string' ? data.id : path.basename(filename, '.md');
  const capturedAt = coerceTimestamp(data.capturedAt);
  const status = data.status;
  if (typeof status !== 'string' || !(STATUS_VALUES as string[]).includes(status)) return null;
  if (!capturedAt) return null;
  const summary: EntrySummary = {
    id,
    capturedAt,
    status: status as EntryStatus,
  };
  if (typeof data.category === 'string' && (CATEGORY_VALUES as string[]).includes(data.category)) {
    summary.category = data.category as Category;
  }
  if (typeof data.title === 'string') summary.title = data.title;
  if (typeof data.summary === 'string') summary.summary = data.summary;
  const tags = coerceTags(data.tags);
  if (tags.length > 0) summary.tags = tags;
  const processedAt = coerceTimestamp(data.processedAt);
  if (processedAt) summary.processedAt = processedAt;
  const failure = coerceFailure(data.failure);
  if (failure) summary.failure = failure;
  const preview = buildPreview(body);
  if (preview) summary.preview = preview;
  return summary;
}

function parseSummary(filename: string, raw: string): EntrySummary | null {
  const parsed = matter(raw);
  return summaryFromFront(filename, parsed.data as Record<string, unknown>, parsed.content);
}

export async function listEntries(deps: ListDeps = {}): Promise<ListResponse> {
  const home = deps.home ?? os.homedir();
  const readdir = deps.readdir ?? defaultReaddir;
  const readFile = deps.readFile ?? defaultReadFile;
  const dir = braindumpsDir(home);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') return { inbox: [], processed: [] };
    throw err;
  }

  const inbox: EntrySummary[] = [];
  const processed: EntrySummary[] = [];

  for (const name of files) {
    if (!name.endsWith('.md')) continue;
    const filePath = path.join(dir, name);
    let raw: string;
    try {
      raw = await readFile(filePath);
    } catch (err) {
      logger.warn({ filePath, err: (err as Error)?.message }, 'braindump read failed; skipping');
      continue;
    }
    let entry: EntrySummary | null;
    try {
      entry = parseSummary(name, raw);
    } catch (err) {
      logger.warn({ filePath, err: (err as Error)?.message }, 'braindump parse failed; skipping');
      continue;
    }
    if (!entry) continue;
    if (entry.status === 'processed') processed.push(entry);
    else inbox.push(entry);
  }

  const cmp = (a: EntrySummary, b: EntrySummary) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0);
  inbox.sort(cmp);
  processed.sort(cmp);
  return { inbox, processed };
}

// ---- Errors -----------------------------------------------------------

export class EntryNotFoundError extends Error {
  readonly code = 'ENTRY_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'EntryNotFoundError';
  }
}

export class EntryReadError extends Error {
  readonly code = 'READ_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'EntryReadError';
  }
}

// ---- Read -------------------------------------------------------------

export type ReadDeps = {
  home?: string;
  readFile?: (p: string) => Promise<string>;
};

function entryPath(home: string, id: string): string {
  return path.join(braindumpsDir(home), `${id}.md`);
}

async function loadEntryFile(
  id: string,
  deps: ReadDeps,
): Promise<{ front: Record<string, unknown>; body: string }> {
  const home = deps.home ?? os.homedir();
  const readFile = deps.readFile ?? defaultReadFile;
  let raw: string;
  try {
    raw = await readFile(entryPath(home, id));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') throw new EntryNotFoundError(`braindump not found: ${id}`);
    const msg = err instanceof Error ? err.message : String(err);
    throw new EntryReadError(msg.slice(0, 200));
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EntryReadError(`frontmatter parse failed: ${msg.slice(0, 200)}`);
  }
  return { front: parsed.data as Record<string, unknown>, body: parsed.content };
}

export async function readEntryBody(id: string, deps: ReadDeps = {}): Promise<string> {
  const { body } = await loadEntryFile(id, deps);
  return body;
}

export async function readEntry(
  id: string,
  deps: ReadDeps = {},
): Promise<{ summary: EntrySummary; rawText: string }> {
  const { front, body } = await loadEntryFile(id, deps);
  const summary = summaryFromFront(`${id}.md`, front, body);
  if (!summary) throw new EntryReadError(`unrecognized braindump shape for ${id}`);
  return { summary, rawText: body };
}

// ---- Delete -----------------------------------------------------------

export type DeleteDeps = {
  home?: string;
  unlink?: (p: string) => Promise<void>;
};

const defaultUnlink = async (p: string): Promise<void> => fs.promises.unlink(p);

export async function deleteEntry(id: string, deps: DeleteDeps = {}): Promise<void> {
  const home = deps.home ?? os.homedir();
  const unlink = deps.unlink ?? defaultUnlink;
  try {
    await unlink(entryPath(home, id));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') throw new EntryNotFoundError(`braindump not found: ${id}`);
    throw err;
  }
}

// ---- State transitions ------------------------------------------------

export type WriteDeps = ReadDeps & {
  writeFile?: (p: string, data: string) => Promise<void>;
};

async function rewriteFront(
  id: string,
  transform: (front: Record<string, unknown>) => Record<string, unknown>,
  deps: WriteDeps,
): Promise<void> {
  const home = deps.home ?? os.homedir();
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const { front, body } = await loadEntryFile(id, deps);
  const next = transform(front);
  await writeFile(entryPath(home, id), serialize(next, body));
}

export async function markEntryProcessing(id: string, deps: WriteDeps = {}): Promise<void> {
  await rewriteFront(id, (front) => ({ ...front, status: 'processing' }), deps);
}

export const MAX_ATTEMPTS = 3;

function withoutFailure(front: Record<string, unknown>): Record<string, unknown> {
  const { failure: _drop, ...rest } = front;
  return rest;
}

export async function markEntryProcessed(
  id: string,
  fields: ProcessedFields,
  deps: WriteDeps = {},
): Promise<void> {
  await rewriteFront(
    id,
    (front) => ({
      ...withoutFailure(front),
      status: 'processed',
      category: fields.category,
      title: fields.title,
      summary: fields.summary,
      tags: fields.tags,
      processedAt: fields.processedAt,
    }),
    deps,
  );
}

export type FailureUpdate = { error: string; at: string };

export async function markEntryFailed(
  id: string,
  update: FailureUpdate,
  deps: WriteDeps = {},
): Promise<void> {
  await rewriteFront(
    id,
    (front) => {
      const prev = coerceFailure(front.failure);
      const attempts = (prev?.attempts ?? 0) + 1;
      const nextStatus: EntryStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'new';
      return {
        ...front,
        status: nextStatus,
        failure: {
          attempts,
          lastError: update.error.slice(0, 500),
          lastAttemptAt: update.at,
        },
      };
    },
    deps,
  );
}

export async function reprocessEntry(id: string, deps: WriteDeps = {}): Promise<void> {
  await rewriteFront(id, (front) => ({ ...withoutFailure(front), status: 'new' }), deps);
}
