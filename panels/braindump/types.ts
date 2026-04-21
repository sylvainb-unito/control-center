export type {
  Category,
  EntryStatus,
  FailureInfo,
  EntrySummary,
  ListResponse,
  ProcessedFields,
} from '@cc/server/lib/braindump';

// Mirrors @cc/server/lib/braindump; re-exporting values would pull node deps into the web bundle.
export const CATEGORY_VALUES = ['todo', 'thought', 'read-later'] as const;
export const MAX_RAW_LEN = 8000;

export type CaptureRequest = { rawText: string };
export type CaptureResponse = { id: string };
export type BodyResponse = { rawText: string };
