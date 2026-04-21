export type Tier = 'daily' | 'weekly' | 'monthly';

export type JournalSummary = {
  id: string;
  tier: Tier;
  date: string;
  repos: string[];
  sessions: number | null;
  period?: string;
};

export type ListResponse = {
  daily: JournalSummary[];
  weekly: JournalSummary[];
  monthly: JournalSummary[];
};

export type BodyResponse = {
  body: string;
};
