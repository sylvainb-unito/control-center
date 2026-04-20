import fs from 'node:fs';
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
  const entries = Object.entries(result.tokensByModel);
  if (entries.length > 0) {
    entries.sort(([modelA, bucketA], [modelB, bucketB]) => {
      if (bucketB.output !== bucketA.output) return bucketB.output - bucketA.output;
      const idxA = lastAssistantIdxByModel.get(modelA) ?? 0;
      const idxB = lastAssistantIdxByModel.get(modelB) ?? 0;
      return idxB - idxA;
    });
    result.primaryModel = entries[0]?.[0] ?? null;
  }

  return result;
}

export type ModelRates = {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheCreationPerMtok: number;
};

export type Pricing = Record<string, ModelRates>;

export function loadPricing(path: string): Pricing {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Pricing;
    for (const [model, rates] of Object.entries(parsed)) {
      const values = Object.values(rates);
      if (values.length !== 4 || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        logger.warn({ path, model }, 'malformed rate in model pricing; skipping model');
        delete parsed[model];
      }
    }
    return parsed;
  } catch (err) {
    logger.warn({ path, err: (err as Error)?.message }, 'failed to load model pricing; using empty pricing');
    return {};
  }
}

export function applyPricing(
  tokensByModel: Record<string, TokenBucket>,
  pricing: Pricing,
): { estCostUsd: number; pricingMissing: boolean } {
  let estCostUsd = 0;
  let pricingMissing = false;
  for (const [model, bucket] of Object.entries(tokensByModel)) {
    const rates = pricing[model];
    if (!rates) {
      pricingMissing = true;
      continue;
    }
    estCostUsd += (bucket.input / 1_000_000) * rates.inputPerMtok;
    estCostUsd += (bucket.output / 1_000_000) * rates.outputPerMtok;
    estCostUsd += (bucket.cacheRead / 1_000_000) * rates.cacheReadPerMtok;
    estCostUsd += (bucket.cacheCreation / 1_000_000) * rates.cacheCreationPerMtok;
  }
  return { estCostUsd, pricingMissing };
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
