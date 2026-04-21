export type AiNewsCategory = 'tool' | 'model' | 'protocol' | 'research' | 'community';

export const CATEGORY_VALUES = ['tool', 'model', 'protocol', 'research', 'community'] as const;

export type AiNewsItem = {
  id: string;
  title: string;
  oneLineSummary: string;
  url: string;
  category: AiNewsCategory;
  starred: boolean;
};

export type AiNewsDigest = {
  date: string;
  runAt: string;
  summary: string;
  items: AiNewsItem[];
};

export type AiNewsState = {
  isRunning: boolean;
  lastRunAt?: string;
  lastError?: string;
};

export type TodayResponse = { digest: AiNewsDigest | null; state: AiNewsState };
export type StarredResponse = { items: (AiNewsItem & { digestDate: string })[] };
export type StarResponse = { starred: boolean };
export type RunResponse = { triggered: true };
