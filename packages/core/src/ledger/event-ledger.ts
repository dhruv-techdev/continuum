/**
 * Append-only JSONL event ledger.
 *
 * Invariants:
 *   1. Events are only appended, never modified or deleted (ST1).
 *   2. Each line is the complete original event JSON (ST2).
 *   3. Sequence numbers must be strictly increasing (ST2).
 *   4. An event ID can only appear once in the ledger (ST3).
 *   5. Hash integrity is verified on every read (ST2).
 *
 * The ledger lazily loads an in-memory index of known IDs and
 * the current sequence on first write or read. This index is
 * authoritative for deduplication — no external state needed.
 */

import { existsSync, readFileSync, appendFileSync, statSync } from 'fs';
import { join } from 'path';
import { verifyEventHash } from '../events/hash';
import type { ContinuumEvent } from '../events/types';
import type {
  AppendResult,
  AppendBatchResult,
  LedgerReadResult,
  LedgerStats,
  IntegrityIssue,
} from './types';

const LEDGER_FILENAME = 'events.jsonl';

export class EventLedger {
  readonly path: string;

  /** Known event IDs for dedup (ST3) */
  private knownIds: Set<string> | null = null;

  /** Highest sequence seen, for ordering enforcement (ST2) */
  private highSequence: number = -1;

  /** Total events tracked without full re-read */
  private cachedCount: number = 0;

  constructor(sessionDir: string) {
    this.path = join(sessionDir, LEDGER_FILENAME);
  }

  // ─── Index management ───────────────────────────────────────

  /**
   * Build the in-memory index by scanning the existing ledger.
   * Called lazily on first append or explicit read.
   */
  private ensureIndex(): void {
    if (this.knownIds !== null) return;

    this.knownIds = new Set();
    this.highSequence = -1;
    this.cachedCount = 0;

    if (!existsSync(this.path)) return;

    const raw = readFileSync(this.path, 'utf-8');
    const lines = raw.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const event = JSON.parse(trimmed) as ContinuumEvent;

        if (typeof event.id === 'string') {
          this.knownIds.add(event.id);
        }

        if (typeof event.sequence === 'number' && event.sequence > this.highSequence) {
          this.highSequence = event.sequence;
        }

        this.cachedCount++;
      } catch {
        // Corrupted line — counted but not indexed.
        // Will surface as IntegrityIssue on readAll().
      }
    }
  }

  // ─── ST3: Duplicate check ──────────────────────────────────

  has(eventId: string): boolean {
    this.ensureIndex();
    return this.knownIds!.has(eventId);
  }

  // ─── ST1: Append-only write ────────────────────────────────

  append(event: ContinuumEvent): AppendResult {
    this.ensureIndex();

    // ST3 — reject duplicates
    if (this.knownIds!.has(event.id)) {
      return {
        status: 'duplicate',
        eventId: event.id,
        sequence: event.sequence,
        error: `Event "${event.id}" already exists in the ledger.`,
      };
    }

    // ST2 — enforce strictly increasing sequence
    if (event.sequence <= this.highSequence) {
      return {
        status: 'sequence_violation',
        eventId: event.id,
        sequence: event.sequence,
        error: `Sequence ${event.sequence} is not greater than current high sequence ${this.highSequence}.`,
      };
    }

    // Verify hash before writing — refuse to persist a tampered event
    if (!verifyEventHash(event)) {
      return {
        status: 'hash_mismatch',
        eventId: event.id,
        sequence: event.sequence,
        error: `Event "${event.id}" has an invalid content hash. Refusing to persist.`,
      };
    }

    // ST1 + ST2 — append the original JSON as a single line
    const line = JSON.stringify(event);

    try {
      const prefix = this.cachedCount > 0 ? '\n' : '';
      appendFileSync(this.path, prefix + line, 'utf-8');
    } catch (err) {
      return {
        status: 'write_error',
        eventId: event.id,
        sequence: event.sequence,
        error: `Failed to write event: ${(err as Error).message}`,
      };
    }

    // Update index
    this.knownIds!.add(event.id);
    this.highSequence = event.sequence;
    this.cachedCount++;

    return {
      status: 'ok',
      eventId: event.id,
      sequence: event.sequence,
    };
  }

  appendBatch(events: ContinuumEvent[]): AppendBatchResult {
    let appended = 0;
    let duplicatesSkipped = 0;
    const errors: AppendResult[] = [];

    for (const event of events) {
      const result = this.append(event);

      switch (result.status) {
        case 'ok':
          appended++;
          break;
        case 'duplicate':
          duplicatesSkipped++;
          break;
        default:
          errors.push(result);
          break;
      }
    }

    return {
      appended,
      duplicatesSkipped,
      errors,
      totalProcessed: events.length,
    };
  }

  // ─── ST2: Read with ordering and integrity verification ────

  readAll(): LedgerReadResult {
    if (!existsSync(this.path)) {
      return { events: [], totalLines: 0, integrityIssues: [] };
    }

    const raw = readFileSync(this.path, 'utf-8');
    const lines = raw.split('\n');
    const events: ContinuumEvent[] = [];
    const integrityIssues: IntegrityIssue[] = [];
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      // Parse
      let event: ContinuumEvent;
      try {
        event = JSON.parse(trimmed) as ContinuumEvent;
      } catch (err) {
        integrityIssues.push({
          line: lineNumber,
          eventId: null,
          message: `Invalid JSON on line ${lineNumber}: ${(err as Error).message}`,
        });
        continue;
      }

      // Verify hash integrity (ST2)
      if (!verifyEventHash(event)) {
        integrityIssues.push({
          line: lineNumber,
          eventId: event.id ?? null,
          message: `Hash mismatch on line ${lineNumber} (event ${event.id}). Payload may have been modified.`,
        });
        // Still include the event — the caller decides what to do
        events.push(event);
        continue;
      }

      events.push(event);
    }

    // Verify ordering (ST2)
    for (let i = 1; i < events.length; i++) {
      if (events[i].sequence <= events[i - 1].sequence) {
        integrityIssues.push({
          line: 0,
          eventId: events[i].id,
          message: `Sequence order violation: event "${events[i].id}" (seq ${events[i].sequence}) is not after "${events[i - 1].id}" (seq ${events[i - 1].sequence}).`,
        });
      }
    }

    return {
      events,
      totalLines: lineNumber,
      integrityIssues,
    };
  }

  readRange(startSeq: number, endSeq: number): LedgerReadResult {
    const full = this.readAll();
    const filtered = full.events.filter((e) => e.sequence >= startSeq && e.sequence <= endSeq);
    return {
      events: filtered,
      totalLines: full.totalLines,
      integrityIssues: full.integrityIssues,
    };
  }

  getEvent(eventId: string): ContinuumEvent | null {
    this.ensureIndex();

    if (!this.knownIds!.has(eventId)) return null;

    // Linear scan — acceptable for Phase 1 local use
    const full = this.readAll();
    return full.events.find((e) => e.id === eventId) ?? null;
  }

  // ─── Stats ─────────────────────────────────────────────────

  stats(): LedgerStats {
    if (!existsSync(this.path)) {
      return {
        eventCount: 0,
        lastSequence: -1,
        firstTimestamp: null,
        lastTimestamp: null,
        byteSize: 0,
      };
    }

    const full = this.readAll();
    const byteSize = statSync(this.path).size;

    return {
      eventCount: full.events.length,
      lastSequence: full.events.length > 0 ? full.events[full.events.length - 1].sequence : -1,
      firstTimestamp: full.events.length > 0 ? full.events[0].timestamp : null,
      lastTimestamp: full.events.length > 0 ? full.events[full.events.length - 1].timestamp : null,
      byteSize,
    };
  }

  count(): number {
    this.ensureIndex();
    return this.cachedCount;
  }

  lastSequence(): number {
    this.ensureIndex();
    return this.highSequence;
  }
}

// ─── Convenience factory ────────────────────────────────────

export function openLedger(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
): EventLedger {
  const sessionDir = join(workspaceRoot, 'projects', projectId, 'sessions', sessionId);
  return new EventLedger(sessionDir);
}
