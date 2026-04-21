export type TokenBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type SessionSummary = {
  sessionId: string;
  project: string;
  cwd: string;
  gitBranch: string | null;
  startedAt: string;
  lastActivityAt: string;
  durationMs: number;
  messageCount: number;
  primaryModel: string | null;
  tokens: TokenBucket;
  estCostUsd: number;
  pricingMissing: boolean;
  isLive: boolean;
};

export type ListResponse = {
  sessions: SessionSummary[];
  stats: {
    count: number;
    durationMs: number;
    messageCount: number;
    tokens: TokenBucket;
    estCostUsd: number;
    pricingMissing: boolean;
  };
  window: {
    officeDays: number;
    cutoffAt: string;
  };
};
