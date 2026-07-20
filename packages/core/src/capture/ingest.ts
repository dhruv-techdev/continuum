/**
 * Event ingestion from files and raw input.
 *
 * Supports:
 *   - JSONL files (one event per line)
 *   - JSON files (array of events or single event)
 *   - Stdin streaming (JSONL)
 *   - Single event objects from CLI quick-capture
 *
 * Every ingested event passes through validation and the
 * append-only ledger for dedup and ordering.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { openLedger } from '../ledger/event-ledger';
import { validateEvent } from '../events/validation';
import { createEvent } from '../events/factory';
import type { ContinuumEvent, EventType } from '../events/types';

// ─── Capture result (ST3) ───────────────────────────────────

export interface CaptureResult {
  appended: number;
  duplicatesSkipped: number;
  validationErrors: number;
  parseErrors: number;
  totalProcessed: number;
  errors: CaptureError[];
}

export interface CaptureError {
  line: number | null;
  eventId: string | null;
  message: string;
}

// ─── Parse raw input into events ────────────────────────────

function parseJsonlLines(raw: string): {
  events: Record<string, unknown>[];
  errors: CaptureError[];
} {
  const lines = raw.split('\n');
  const events: Record<string, unknown>[] = [];
  const errors: CaptureError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        // If a line contains an array, flatten it
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            events.push(item as Record<string, unknown>);
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        events.push(parsed as Record<string, unknown>);
      } else {
        errors.push({ line: i + 1, eventId: null, message: `Line ${i + 1}: not an object.` });
      }
    } catch (err) {
      errors.push({
        line: i + 1,
        eventId: null,
        message: `Line ${i + 1}: ${(err as Error).message}`,
      });
    }
  }

  return { events, errors };
}

// ─── Ingest pre-formed events from raw input ────────────────

export function ingestRawEvents(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  raw: string,
): CaptureResult {
  const result: CaptureResult = {
    appended: 0,
    duplicatesSkipped: 0,
    validationErrors: 0,
    parseErrors: 0,
    totalProcessed: 0,
    errors: [],
  };

  const { events: parsed, errors: parseErrors } = parseJsonlLines(raw);
  result.parseErrors = parseErrors.length;
  result.errors.push(...parseErrors);

  const ledger = openLedger(workspaceRoot, projectId, sessionId);
  const valid: ContinuumEvent[] = [];

  for (const obj of parsed) {
    result.totalProcessed++;

    const validationErrors = validateEvent(obj);
    if (validationErrors.length > 0) {
      result.validationErrors++;
      const id = typeof obj.id === 'string' ? obj.id : null;
      result.errors.push({
        line: null,
        eventId: id,
        message: validationErrors.map((e) => `${e.field}: ${e.message}`).join('; '),
      });
      continue;
    }

    valid.push(obj as unknown as ContinuumEvent);
  }

  if (valid.length > 0) {
    const batchResult = ledger.appendBatch(valid);
    result.appended = batchResult.appended;
    result.duplicatesSkipped = batchResult.duplicatesSkipped;

    for (const err of batchResult.errors) {
      result.errors.push({
        line: null,
        eventId: err.eventId,
        message: err.error ?? `Append failed: ${err.status}`,
      });
    }
  }

  return result;
}

// ─── Ingest from file (ST1) ─────────────────────────────────

export function ingestFromFile(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  filePath: string,
): CaptureResult {
  if (!existsSync(filePath)) {
    return {
      appended: 0,
      duplicatesSkipped: 0,
      validationErrors: 0,
      parseErrors: 1,
      totalProcessed: 0,
      errors: [{ line: null, eventId: null, message: `File not found: ${filePath}` }],
    };
  }

  const raw = readFileSync(filePath, 'utf-8');
  return ingestRawEvents(workspaceRoot, projectId, sessionId, raw);
}

// ─── Quick capture: create + append a single event ──────────

export interface QuickCaptureInput {
  workspaceRoot: string;
  projectId: string;
  sessionId: string;
  type: EventType;
  source: string;
  payload: Record<string, unknown>;
}

export function quickCapture(input: QuickCaptureInput): CaptureResult {
  const result: CaptureResult = {
    appended: 0,
    duplicatesSkipped: 0,
    validationErrors: 0,
    parseErrors: 0,
    totalProcessed: 1,
    errors: [],
  };

  const ledger = openLedger(input.workspaceRoot, input.projectId, input.sessionId);
  const nextSeq = ledger.lastSequence() + 1;

  const event = createEvent({
    type: input.type,
    projectId: input.projectId,
    sessionId: input.sessionId,
    sequence: nextSeq,
    source: input.source,
    payload: input.payload as never,
  });

  const appendResult = ledger.append(event);

  if (appendResult.status === 'ok') {
    result.appended = 1;
  } else if (appendResult.status === 'duplicate') {
    result.duplicatesSkipped = 1;
  } else {
    result.errors.push({
      line: null,
      eventId: appendResult.eventId,
      message: appendResult.error ?? `Append failed: ${appendResult.status}`,
    });
  }

  return result;
}

// ─── Update session event count ─────────────────────────────

export function updateSessionAfterCapture(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  newEvents: number,
): void {
  if (newEvents === 0) return;

  const sessionManifestPath = join(
    workspaceRoot,
    'projects',
    projectId,
    'sessions',
    sessionId,
    'session.json',
  );

  if (!existsSync(sessionManifestPath)) return;

  try {
    const raw = readFileSync(sessionManifestPath, 'utf-8');
    const session = JSON.parse(raw);
    session.eventCount = (session.eventCount ?? 0) + newEvents;
    writeFileSync(sessionManifestPath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-fatal
  }
}
