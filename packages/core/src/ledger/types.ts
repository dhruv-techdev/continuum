import type { ContinuumEvent } from '../events/types';

// ─── Append results ─────────────────────────────────────────

export type AppendStatus =
  'ok' | 'duplicate' | 'sequence_violation' | 'hash_mismatch' | 'write_error';

export interface AppendResult {
  status: AppendStatus;
  eventId: string;
  sequence: number;
  error?: string;
}

export interface AppendBatchResult {
  appended: number;
  duplicatesSkipped: number;
  errors: AppendResult[];
  totalProcessed: number;
}

// ─── Read results ───────────────────────────────────────────

export interface IntegrityIssue {
  line: number;
  eventId: string | null;
  message: string;
}

export interface LedgerReadResult {
  events: ContinuumEvent[];
  totalLines: number;
  integrityIssues: IntegrityIssue[];
}

// ─── Ledger stats ───────────────────────────────────────────

export interface LedgerStats {
  eventCount: number;
  lastSequence: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  byteSize: number;
}
