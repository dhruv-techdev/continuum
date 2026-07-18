/**
 * Full integrity verification for a session ledger.
 *
 * Checks performed:
 *   1. JSON parse-ability of every line
 *   2. SHA-256 content hash matches stored hash (ST1 + ST2)
 *   3. Strictly increasing sequence numbers
 *   4. No duplicate event IDs
 *   5. Schema field validation (id format, timestamps, required fields)
 *   6. Cross-event consistency (session/project ID uniformity)
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { verifyEventHash } from '../events/hash';
import { validateEvent } from '../events/validation';
import type { ValidationError } from '../index';

// ─── Types ──────────────────────────────────────────────────

export const IssueSeverities = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export type IssueSeverity = (typeof IssueSeverities)[keyof typeof IssueSeverities];

export const IssueCategories = {
  PARSE: 'parse',
  HASH: 'hash',
  SEQUENCE: 'sequence',
  DUPLICATE: 'duplicate',
  SCHEMA: 'schema',
  CONSISTENCY: 'consistency',
} as const;

export type IssueCategory = (typeof IssueCategories)[keyof typeof IssueCategories];

export interface VerificationIssue {
  line: number;
  eventId: string | null;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
}

export interface VerificationReport {
  ledgerPath: string;
  totalLines: number;
  totalEvents: number;
  validEvents: number;
  issues: VerificationIssue[];
  passed: boolean;
  byteSize: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  durationMs: number;
}

// ─── Verify ─────────────────────────────────────────────────

export function verifyLedger(ledgerPath: string): VerificationReport {
  const start = Date.now();

  const empty: VerificationReport = {
    ledgerPath,
    totalLines: 0,
    totalEvents: 0,
    validEvents: 0,
    issues: [],
    passed: true,
    byteSize: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    durationMs: 0,
  };

  if (!existsSync(ledgerPath)) {
    empty.issues.push({
      line: 0,
      eventId: null,
      severity: IssueSeverities.ERROR,
      category: IssueCategories.PARSE,
      message: `Ledger file not found: ${ledgerPath}`,
    });
    empty.passed = false;
    empty.durationMs = Date.now() - start;
    return empty;
  }

  const raw = readFileSync(ledgerPath, 'utf-8');
  const byteSize = statSync(ledgerPath).size;
  const lines = raw.split('\n');

  const issues: VerificationIssue[] = [];
  const seenIds = new Set<string>();
  const events: Array<{ line: number; id: string; sequence: number; timestamp: string; projectId: string; sessionId: string }> = [];
  let validEvents = 0;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // 1. JSON parse
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch (err) {
      issues.push({
        line: lineNumber,
        eventId: null,
        severity: IssueSeverities.ERROR,
        category: IssueCategories.PARSE,
        message: `Invalid JSON: ${(err as Error).message}`,
      });
      continue;
    }

    const eventId = typeof event.id === 'string' ? event.id : `(line ${lineNumber})`;

    // 2. Schema validation
    const schemaErrors = validateEvent(event);
    // Separate hash errors from other schema errors to avoid double-reporting
    const hashErrors = schemaErrors.filter((e) => e.field === 'hash' && e.message.includes('modified'));
    const otherErrors = schemaErrors.filter((e) => !(e.field === 'hash' && e.message.includes('modified')));

    for (const err of otherErrors) {
      issues.push({
        line: lineNumber,
        eventId,
        severity: IssueSeverities.ERROR,
        category: IssueCategories.SCHEMA,
        message: `${err.field}: ${err.message}`,
      });
    }

    // 3. Hash integrity (ST1 + ST2)
    if (hashErrors.length > 0) {
      issues.push({
        line: lineNumber,
        eventId,
        severity: IssueSeverities.ERROR,
        category: IssueCategories.HASH,
        message: 'Content hash does not match payload. Event may have been modified.',
      });
    } else if (otherErrors.length === 0) {
      // Only do explicit hash check if validateEvent didn't already catch it
      // (validateEvent checks hash when all other fields are valid)
      // If we reach here with no errors, the hash was already verified by validateEvent.
    }

    // 4. Duplicate ID check (ST3 from US-006, verified here)
    if (typeof event.id === 'string') {
      if (seenIds.has(event.id)) {
        issues.push({
          line: lineNumber,
          eventId,
          severity: IssueSeverities.ERROR,
          category: IssueCategories.DUPLICATE,
          message: `Duplicate event ID "${event.id}" — first seen earlier in the ledger.`,
        });
      } else {
        seenIds.add(event.id);
      }
    }

    const sequence = typeof event.sequence === 'number' ? event.sequence : -1;
    const timestamp = typeof event.timestamp === 'string' ? event.timestamp : '';
    const projectId = typeof event.projectId === 'string' ? event.projectId : '';
    const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';

    events.push({ line: lineNumber, id: eventId, sequence, timestamp, projectId, sessionId });

    if (otherErrors.length === 0 && hashErrors.length === 0) {
      validEvents++;
    }
  }

  // 5. Sequence ordering
  for (let i = 1; i < events.length; i++) {
    if (events[i].sequence <= events[i - 1].sequence) {
      issues.push({
        line: events[i].line,
        eventId: events[i].id,
        severity: IssueSeverities.ERROR,
        category: IssueCategories.SEQUENCE,
        message: `Sequence ${events[i].sequence} is not greater than preceding sequence ${events[i - 1].sequence} (event "${events[i - 1].id}").`,
      });
    }
  }

  // 6. Cross-event consistency
  if (events.length > 1) {
    const firstProject = events[0].projectId;
    const firstSession = events[0].sessionId;

    for (let i = 1; i < events.length; i++) {
      if (events[i].projectId !== firstProject) {
        issues.push({
          line: events[i].line,
          eventId: events[i].id,
          severity: IssueSeverities.WARNING,
          category: IssueCategories.CONSISTENCY,
          message: `projectId "${events[i].projectId}" differs from first event's projectId "${firstProject}".`,
        });
      }
      if (events[i].sessionId !== firstSession) {
        issues.push({
          line: events[i].line,
          eventId: events[i].id,
          severity: IssueSeverities.WARNING,
          category: IssueCategories.CONSISTENCY,
          message: `sessionId "${events[i].sessionId}" differs from first event's sessionId "${firstSession}".`,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === IssueSeverities.ERROR);

  return {
    ledgerPath,
    totalLines: lineNumber,
    totalEvents: events.length,
    validEvents,
    issues,
    passed: !hasErrors,
    byteSize,
    firstTimestamp: events.length > 0 ? events[0].timestamp : null,
    lastTimestamp: events.length > 0 ? events[events.length - 1].timestamp : null,
    durationMs: Date.now() - start,
  };
}

// ─── Convenience: verify by workspace path ──────────────────

export function verifySessionLedger(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
): VerificationReport {
  const { join } = require('path');
  const ledgerPath = join(
    workspaceRoot,
    'projects',
    projectId,
    'sessions',
    sessionId,
    'events.jsonl',
  );
  return verifyLedger(ledgerPath);
}
