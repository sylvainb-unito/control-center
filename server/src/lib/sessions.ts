import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { logger } from '../logger';

export type TokenBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type ParsedSession = {
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  primaryModel: string | null;
  tokensByModel: Record<string, TokenBucket>;
};

type AssistantUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type MaybeLine = {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: { model?: string; usage?: AssistantUsage };
};

function emptyBucket(): TokenBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

export async function parseSessionFile(
  stream: Readable,
  sessionId: string,
): Promise<ParsedSession> {
  const result: ParsedSession = {
    sessionId,
    cwd: '',
    gitBranch: null,
    startedAt: '',
    lastActivityAt: '',
    messageCount: 0,
    primaryModel: null,
    tokensByModel: {},
  };

  // Track the line index at which each model last appeared, for tie-breaking.
  const lastAssistantIdxByModel = new Map<string, number>();
  let lineIdx = 0;
  let loggedParseError = false;

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const raw of rl) {
    lineIdx++;
    if (!raw) continue;
    let obj: MaybeLine;
    try {
      obj = JSON.parse(raw) as MaybeLine;
    } catch {
      if (!loggedParseError) {
        logger.warn({ sessionId, lineIdx }, 'unparseable line in session jsonl (further errors in this session suppressed)');
        loggedParseError = true;
      }
      continue;
    }

    if (obj.cwd && !result.cwd) result.cwd = obj.cwd;
    if (obj.gitBranch && !result.gitBranch) result.gitBranch = obj.gitBranch;
    if (obj.timestamp) {
      if (!result.startedAt) result.startedAt = obj.timestamp;
      result.lastActivityAt = obj.timestamp;
    }
    if (obj.type === 'user' || obj.type === 'assistant') {
      result.messageCount++;
    }
    if (obj.type === 'assistant' && obj.message?.model && obj.message?.usage) {
      const model = obj.message.model;
      const usage = obj.message.usage;
      const bucket = result.tokensByModel[model] ?? emptyBucket();
      bucket.input += usage.input_tokens ?? 0;
      bucket.output += usage.output_tokens ?? 0;
      bucket.cacheRead += usage.cache_read_input_tokens ?? 0;
      bucket.cacheCreation += usage.cache_creation_input_tokens ?? 0;
      result.tokensByModel[model] = bucket;
      lastAssistantIdxByModel.set(model, lineIdx);
    }
  }

  // Primary model: highest output tokens; ties broken by most-recent assistant appearance.
  const models = Object.keys(result.tokensByModel);
  if (models.length > 0) {
    models.sort((a, b) => {
      const outA = result.tokensByModel[a]?.output ?? 0;
      const outB = result.tokensByModel[b]?.output ?? 0;
      if (outB !== outA) return outB - outA;
      const idxA = lastAssistantIdxByModel.get(a) ?? 0;
      const idxB = lastAssistantIdxByModel.get(b) ?? 0;
      return idxB - idxA;
    });
    result.primaryModel = models[0] ?? null;
  }

  return result;
}

export function officeDayCutoff(now: Date, officeDays: number): Date {
  // Cutoff = start-of-day of the weekday exactly `officeDays` weekdays before `now`.
  // The window is [cutoff, now], which includes `now`'s own date.
  const d = new Date(now);
  let remaining = officeDays;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}
