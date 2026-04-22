import crypto from 'node:crypto';
import { logger } from '../logger';
import {
  type AiNewsDigest,
  type DirDeps,
  formatLocalDate,
  listDigests,
  pruneOldDigests,
  readState,
  writeDigest,
  writeState,
} from './ai-news';
import { buildPrompt, isValidLlmOutput } from './ai-news-prompt';
import { extractJson } from './braindump-processor';
import { type RunClaude, defaultRunClaude } from './run-claude';

export type TickDeps = DirDeps & {
  runClaude?: RunClaude;
  now?: () => Date;
  randomId?: () => string;
  timeoutMs?: number;
};

export type RunDigestDeps = TickDeps & { force?: boolean };

const DEFAULT_TIMEOUT_MS = 180_000;
const RETAIN_DAYS = 7;

let isTickInFlight = false;

export function _resetForTests(): void {
  isTickInFlight = false;
}

function defaultRandomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export async function boot(deps: DirDeps = {}): Promise<void> {
  const prev = await readState(deps);
  if (prev.isRunning) {
    await writeState({ ...prev, isRunning: false }, deps);
    logger.warn('ai-news: cleared stale isRunning from previous run');
  }
}

export async function tick(deps: TickDeps = {}): Promise<void> {
  if (isTickInFlight) {
    logger.debug('ai-news tick skipped (reentrancy)');
    return;
  }
  isTickInFlight = true;
  try {
    const state = await readState(deps);
    if (state.isRunning) {
      logger.debug('ai-news tick skipped (state.isRunning)');
      return;
    }
    const now = (deps.now ?? (() => new Date()))();
    if (now.getHours() < 7) {
      logger.debug({ hour: now.getHours() }, 'ai-news tick skipped (before 7am)');
      return;
    }
    const today = formatLocalDate(now);
    const existing = await listDigests(deps);
    if (existing.includes(today)) {
      logger.debug({ date: today }, 'ai-news tick skipped (digest exists)');
      return;
    }
    await runDigest({ ...deps, force: false });
  } finally {
    isTickInFlight = false;
  }
}

export async function runDigest(deps: RunDigestDeps = {}): Promise<void> {
  const runClaude = deps.runClaude ?? defaultRunClaude;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? defaultRandomId;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const targetDate = formatLocalDate(now());
  const prevState = await readState(deps);

  await writeState(
    { isRunning: true, lastRunAt: prevState.lastRunAt, lastError: prevState.lastError },
    deps,
  );

  try {
    const raw = await runClaude({ prompt: buildPrompt(), input: '', timeoutMs });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      throw new Error(`claude output was not JSON: ${(err as Error).message}`);
    }
    if (!isValidLlmOutput(parsed)) {
      throw new Error('claude output did not match expected schema');
    }
    const digest: AiNewsDigest = {
      date: targetDate,
      runAt: now().toISOString(),
      summary: parsed.summary,
      items: parsed.items.map((it) => ({
        id: randomId(),
        title: it.title,
        oneLineSummary: it.oneLineSummary,
        url: it.url,
        category: it.category,
        starred: false,
      })),
    };
    await writeDigest(digest, deps);
    await writeState({ isRunning: false, lastRunAt: digest.runAt }, deps);
    await pruneOldDigests(now(), RETAIN_DAYS, deps);
    logger.info({ date: targetDate, items: digest.items.length }, 'ai-news digest written');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeState({ isRunning: false, lastRunAt: prevState.lastRunAt, lastError: msg }, deps);
    logger.warn({ err: msg }, 'ai-news digest run failed');
  }
}
