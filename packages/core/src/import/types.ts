/**
 * Types for transcript import.
 *
 * These are internal to the import pipeline. The output is
 * always ContinuumEvent[] — the canonical schema from US-003.
 */

// ─── Parsed message (intermediate representation) ───────────

export interface ParsedMessage {
  role: string;
  content: string;
  /** Original fields the parser could read but not map */
  unmappedFields: Record<string, unknown>;
}

// ─── Import warnings (ST3) ──────────────────────────────────

export const WarningTypes = {
  UNSUPPORTED_FIELD: 'unsupported_field',
  INACCESSIBLE: 'inaccessible',
  SKIPPED_MESSAGE: 'skipped_message',
  COERCED: 'coerced',
  EMPTY_CONTENT: 'empty_content',
} as const;

export type WarningType = (typeof WarningTypes)[keyof typeof WarningTypes];

export interface ImportWarning {
  type: WarningType;
  field: string;
  message: string;
  /** Zero-based index of the message in the source, if applicable */
  messageIndex?: number;
}

// ─── Parse result (parser → normalizer) ─────────────────────

export type TranscriptFormat = 'json' | 'markdown';

export interface ParseResult {
  messages: ParsedMessage[];
  format: TranscriptFormat;
  warnings: ImportWarning[];
  /** Provider detected from the transcript structure, if any */
  detectedProvider: string | null;
}

// ─── Import result (normalizer → caller) ────────────────────

export interface ImportStats {
  totalParsed: number;
  eventsCreated: number;
  skipped: number;
  warningCount: number;
}

export interface ImportResult {
  eventCount: number;
  warnings: ImportWarning[];
  stats: ImportStats;
}
