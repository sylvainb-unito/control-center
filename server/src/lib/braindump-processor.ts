import { spawn } from 'node:child_process';

import { logger } from '../logger';
import {
  type EntrySummary,
  type ListDeps,
  type WriteDeps,
  listEntries,
  markEntryFailed,
  markEntryProcessed,
  markEntryProcessing,
  readEntryBody,
} from './braindump';
import { PROMPT, isValidLlmOutput } from './braindump-prompt';

export type RunClaudeArgs = {
  prompt: string;
  input: string;
  timeoutMs: number;
};

export type RunClaude = (args: RunClaudeArgs) => Promise<string>;

export type ProcessDeps = ListDeps &
  WriteDeps & {
    runClaude?: RunClaude;
    now?: () => Date;
    timeoutMs?: number;
  };

export type ProcessResult = {
  processed: number;
  failed: number;
  skipped: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

let isProcessing = false;

export function _resetForTests(): void {
  isProcessing = false;
}

export async function processPending(deps: ProcessDeps = {}): Promise<ProcessResult> {
  if (isProcessing) {
    logger.debug('braindump processor tick skipped (reentrancy)');
    return { processed: 0, failed: 0, skipped: 0 };
  }
  isProcessing = true;
  try {
    const { inbox } = await listEntries(deps);
    const pending = inbox.filter((e) => e.status === 'new');
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const runClaude = deps.runClaude ?? defaultRunClaude;
    const now = deps.now ?? (() => new Date());
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (const entry of pending) {
      const outcome = await processOne(entry, { ...deps, runClaude, now, timeoutMs });
      if (outcome === 'processed') processed++;
      else if (outcome === 'failed') failed++;
      else skipped++;
    }

    logger.info({ processed, failed, skipped }, 'braindump processor tick');
    return { processed, failed, skipped };
  } finally {
    isProcessing = false;
  }
}

async function processOne(
  entry: EntrySummary,
  deps: ProcessDeps & { runClaude: RunClaude; now: () => Date; timeoutMs: number },
): Promise<'processed' | 'failed' | 'skipped'> {
  const id = entry.id;
  try {
    await markEntryProcessing(id, deps);
    const rawText = await readEntryBody(id, deps);
    const raw = await deps.runClaude({
      prompt: PROMPT,
      input: rawText,
      timeoutMs: deps.timeoutMs,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      throw new Error(`claude output was not JSON: ${(err as Error).message}`);
    }
    if (!isValidLlmOutput(parsed)) {
      throw new Error('claude output did not match expected schema');
    }
    await markEntryProcessed(
      id,
      {
        category: parsed.category,
        title: parsed.title,
        summary: parsed.summary,
        tags: parsed.tags,
        processedAt: deps.now().toISOString(),
      },
      deps,
    );
    return 'processed';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ id, err: msg }, 'braindump process failed');
    try {
      await markEntryFailed(id, { error: msg, at: deps.now().toISOString() }, deps);
      return 'failed';
    } catch (err2) {
      logger.error(
        { id, err: (err2 as Error).message },
        'braindump process failure bookkeeping failed',
      );
      return 'skipped';
    }
  }
}

// Tolerates prose or ```json fences around the JSON payload — LLMs ignore
// "no code fence" instructions ~20% of the time.
export function extractJson(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

// ---- Default runClaude (spawns `claude -p`) ---------------------------

export const defaultRunClaude: RunClaude = async ({ prompt, input, timeoutMs }) => {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `claude -p exited with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
          ),
        );
    });

    // Swallow EPIPE if claude exits before we finish writing; the close handler reports the real cause.
    child.stdin.on('error', () => {});
    child.stdin.end(`${prompt}${input}\n`);
  });
};
