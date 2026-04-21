export type Category = 'todo' | 'thought' | 'read-later';
export type EntryStatus = 'new' | 'processing' | 'processed' | 'failed';

export type EntrySummary = {
  id: string;
  capturedAt: string;
  status: EntryStatus;
  category?: Category;
  title?: string;
  summary?: string;
  tags?: string[];
  processedAt?: string;
  failure?: { attempts: number; lastError: string; lastAttemptAt: string };
};

export type ListResponse = {
  inbox: EntrySummary[];
  processed: EntrySummary[];
};

export type CaptureRequest = { rawText: string };
export type CaptureResponse = { id: string };
export type BodyResponse = { rawText: string };
