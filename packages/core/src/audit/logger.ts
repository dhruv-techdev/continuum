/**
 * Audit logger.
 *
 * Records all significant system operations to an append-only
 * JSONL audit log so that transfer behaviour is explainable.
 *
 * ST1: Records imports, exports, searches, transfers
 * ST2: Records verification, repair, redaction operations
 * ST3: Tracks errors, durations, and transfer outcomes
 */

import { existsSync, appendFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ─── Operation types (ST1 + ST2) ────────────────────────────

export const AuditOperations = {
  // ST1: Data operations
  IMPORT: 'import',
  EXPORT: 'export',
  CAPSULE_EXPORT: 'capsule_export',
  CAPSULE_IMPORT: 'capsule_import',
  SCOPED_EXPORT: 'scoped_export',
  CAPTURE: 'capture',
  SEARCH: 'search',
  TRANSFER: 'transfer',

  // ST1: Project operations
  PROJECT_CREATE: 'project_create',
  PROJECT_SELECT: 'project_select',
  SESSION_START: 'session_start',
  SESSION_CLOSE: 'session_close',

  // ST2: Verification and integrity
  VERIFY_GENERATE: 'verify_generate',
  VERIFY_SCORE: 'verify_score',
  VERIFY_REPAIR: 'verify_repair',
  LEDGER_VERIFY: 'ledger_verify',

  // ST2: Privacy
  REDACTION_SCAN: 'redaction_scan',
  REDACTION_APPLY: 'redaction_apply',

  // ST2: State operations
  STATE_EXTRACT: 'state_extract',
  STATE_REGENERATE: 'state_regenerate',
  STATE_CORRECT: 'state_correct',

  // ST2: Database
  DB_SYNC: 'db_sync',
  DB_RESET: 'db_reset',

  // General
  ERROR: 'error',
} as const;

export type AuditOperation = (typeof AuditOperations)[keyof typeof AuditOperations];

// ─── Outcome (ST3) ──────────────────────────────────────────

export const AuditOutcomes = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  PARTIAL: 'partial',
  SKIPPED: 'skipped',
} as const;

export type AuditOutcome = (typeof AuditOutcomes)[keyof typeof AuditOutcomes];

// ─── Audit entry ────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  operation: AuditOperation;
  outcome: AuditOutcome;
  projectId: string | null;
  sessionId: string | null;
  /** Duration in milliseconds (ST3) */
  durationMs: number | null;
  /** Operation-specific details */
  details: Record<string, unknown>;
  /** Error message if outcome is failure (ST3) */
  error: string | null;
}

// ─── Log file management ────────────────────────────────────

const AUDIT_DIR = 'logs';
const AUDIT_FILE = 'audit.jsonl';

function auditPath(workspaceRoot: string): string {
  return join(workspaceRoot, AUDIT_DIR, AUDIT_FILE);
}

function ensureDir(workspaceRoot: string): void {
  const dir = join(workspaceRoot, AUDIT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ─── Write an audit entry ───────────────────────────────────

export function logAudit(
  workspaceRoot: string,
  operation: AuditOperation,
  outcome: AuditOutcome,
  details: Record<string, unknown> = {},
  options: {
    projectId?: string;
    sessionId?: string;
    durationMs?: number;
    error?: string;
  } = {},
): AuditEntry {
  ensureDir(workspaceRoot);

  const entry: AuditEntry = {
    id: `aud_${randomUUID().slice(0, 12)}`,
    timestamp: new Date().toISOString(),
    operation,
    outcome,
    projectId: options.projectId ?? null,
    sessionId: options.sessionId ?? null,
    durationMs: options.durationMs ?? null,
    details,
    error: options.error ?? null,
  };

  const path = auditPath(workspaceRoot);
  const line = JSON.stringify(entry);

  if (existsSync(path)) {
    appendFileSync(path, '\n' + line, 'utf-8');
  } else {
    appendFileSync(path, line, 'utf-8');
  }

  return entry;
}

// ─── Timed operation helper (ST3) ───────────────────────────

export async function timedOperation<T>(
  workspaceRoot: string,
  operation: AuditOperation,
  projectId: string | undefined,
  fn: () => T,
  detailsFn?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const start = Date.now();

  try {
    const result = fn();
    const durationMs = Date.now() - start;
    const details = detailsFn ? detailsFn(result) : {};

    logAudit(workspaceRoot, operation, AuditOutcomes.SUCCESS, details, {
      projectId,
      durationMs,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;

    logAudit(workspaceRoot, operation, AuditOutcomes.FAILURE, {}, {
      projectId,
      durationMs,
      error: (err as Error).message,
    });

    throw err;
  }
}

export function timedSync<T>(
  workspaceRoot: string,
  operation: AuditOperation,
  projectId: string | undefined,
  fn: () => T,
  detailsFn?: (result: T) => Record<string, unknown>,
): T {
  const start = Date.now();

  try {
    const result = fn();
    const durationMs = Date.now() - start;
    const details = detailsFn ? detailsFn(result) : {};

    logAudit(workspaceRoot, operation, AuditOutcomes.SUCCESS, details, {
      projectId,
      durationMs,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;

    logAudit(workspaceRoot, operation, AuditOutcomes.FAILURE, {}, {
      projectId,
      durationMs,
      error: (err as Error).message,
    });

    throw err;
  }
}

// ─── Read audit log ─────────────────────────────────────────

export interface AuditQuery {
  operation?: AuditOperation;
  outcome?: AuditOutcome;
  projectId?: string;
  after?: string;
  before?: string;
  limit?: number;
}

export function readAuditLog(workspaceRoot: string, query: AuditQuery = {}): AuditEntry[] {
  const path = auditPath(workspaceRoot);

  if (!existsSync(path)) return [];

  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  let entries: AuditEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Skip malformed lines
    }
  }

  // Apply filters
  if (query.operation) {
    entries = entries.filter((e) => e.operation === query.operation);
  }
  if (query.outcome) {
    entries = entries.filter((e) => e.outcome === query.outcome);
  }
  if (query.projectId) {
    entries = entries.filter((e) => e.projectId === query.projectId);
  }
  if (query.after) {
    entries = entries.filter((e) => e.timestamp > query.after!);
  }
  if (query.before) {
    entries = entries.filter((e) => e.timestamp < query.before!);
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply limit
  if (query.limit && query.limit > 0) {
    entries = entries.slice(0, query.limit);
  }

  return entries;
}

// ─── Audit statistics (ST3) ─────────────────────────────────

export interface AuditStats {
  totalEntries: number;
  byOperation: Record<string, number>;
  byOutcome: Record<string, number>;
  errorCount: number;
  avgDurationMs: Record<string, number>;
  firstEntry: string | null;
  lastEntry: string | null;
  transferOutcomes: {
    exports: number;
    imports: number;
    verifications: number;
    repairs: number;
    scans: number;
  };
}

export function getAuditStats(workspaceRoot: string, projectId?: string): AuditStats {
  const entries = readAuditLog(workspaceRoot, { projectId });

  const byOperation: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const durations: Record<string, number[]> = {};
  let errorCount = 0;

  for (const entry of entries) {
    byOperation[entry.operation] = (byOperation[entry.operation] ?? 0) + 1;
    byOutcome[entry.outcome] = (byOutcome[entry.outcome] ?? 0) + 1;

    if (entry.outcome === AuditOutcomes.FAILURE) errorCount++;

    if (entry.durationMs !== null) {
      if (!durations[entry.operation]) durations[entry.operation] = [];
      durations[entry.operation].push(entry.durationMs);
    }
  }

  const avgDurationMs: Record<string, number> = {};
  for (const [op, times] of Object.entries(durations)) {
    avgDurationMs[op] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }

  return {
    totalEntries: entries.length,
    byOperation,
    byOutcome,
    errorCount,
    avgDurationMs,
    firstEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
    lastEntry: entries.length > 0 ? entries[0].timestamp : null,
    transferOutcomes: {
      exports: (byOperation[AuditOperations.CAPSULE_EXPORT] ?? 0) + (byOperation[AuditOperations.SCOPED_EXPORT] ?? 0) + (byOperation[AuditOperations.EXPORT] ?? 0),
      imports: (byOperation[AuditOperations.CAPSULE_IMPORT] ?? 0) + (byOperation[AuditOperations.IMPORT] ?? 0),
      verifications: (byOperation[AuditOperations.VERIFY_SCORE] ?? 0),
      repairs: (byOperation[AuditOperations.VERIFY_REPAIR] ?? 0),
      scans: (byOperation[AuditOperations.REDACTION_SCAN] ?? 0),
    },
  };
}
