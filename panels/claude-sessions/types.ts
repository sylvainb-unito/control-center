import type { SessionSummary, TokenBucket } from '@cc/server/lib/sessions';

export type { SessionSummary, TokenBucket };

export type ListResponse = {
  sessions: SessionSummary[];
  stats: {
    count: number;
    durationMs: number;
    messageCount: number;
    tokens: TokenBucket;
  };
  window: {
    officeDays: number;
    cutoffAt: string;
  };
};
