export type {
  Category,
  EntryStatus,
  FailureInfo,
  EntrySummary,
  ListResponse,
  ProcessedFields,
} from '@cc/server/lib/braindump';

export type CaptureRequest = { rawText: string };
export type CaptureResponse = { id: string };
export type BodyResponse = { rawText: string };
