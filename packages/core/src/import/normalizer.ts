/**
 * Normalizer: ParsedMessage[] → ContinuumEvent[]
 *
 * Maps parsed role strings to canonical MessageRole,
 * creates events via the factory, and writes them through
 * the EventLedger for immutable, deduplicated storage.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ParseResult, ImportResult, ImportWarning } from './types';
import { WarningTypes } from './types';
import { createEvent, EventTypes, MessageRoles } from '../events/index';
import { openLedger } from '../ledger/event-ledger';
import type { MessageRole, ContinuumEvent } from '../events/types';

// ─── Role mapping ───────────────────────────────────────────

const ROLE_MAP: Record<string, MessageRole> = {
  user: MessageRoles.USER,
  assistant: MessageRoles.ASSISTANT,
  system: MessageRoles.SYSTEM,
};

function mapRole(parsed: string, index: number, warnings: ImportWarning[]): MessageRole {
  const mapped = ROLE_MAP[parsed];
  if (mapped) return mapped;

  warnings.push({
    type: WarningTypes.COERCED,
    field: `message[${index}].role`,
    message: `Unknown role "${parsed}" coerced to "user". Original value preserved in metadata.`,
    messageIndex: index,
  });
  return MessageRoles.USER;
}

// ─── Normalize ──────────────────────────────────────────────

export interface NormalizeInput {
  parseResult: ParseResult;
  projectId: string;
  sessionId: string;
  source: string;
  startSequence?: number;
}

export interface NormalizeOutput {
  events: ContinuumEvent[];
  warnings: ImportWarning[];
  stats: {
    totalParsed: number;
    eventsCreated: number;
    skipped: number;
  };
}

export function normalizeToEvents(input: NormalizeInput): NormalizeOutput {
  const { parseResult, projectId, sessionId, source, startSequence = 0 } = input;
  const warnings: ImportWarning[] = [...parseResult.warnings];
  const events: ContinuumEvent[] = [];
  const skipped = 0;

  for (let i = 0; i < parseResult.messages.length; i++) {
    const msg = parseResult.messages[i];
    const sequence = startSequence + i;

    const role = mapRole(msg.role, i, warnings);

    const metadata: Record<string, unknown> = {};

    if (Object.keys(msg.unmappedFields).length > 0) {
      metadata.originalFields = msg.unmappedFields;
    }

    if (!ROLE_MAP[msg.role]) {
      metadata.originalRole = msg.role;
    }

    if (parseResult.detectedProvider) {
      metadata.detectedProvider = parseResult.detectedProvider;
    }

    const event = createEvent({
      type: EventTypes.MESSAGE,
      projectId,
      sessionId,
      sequence,
      source,
      payload: {
        role,
        content: msg.content,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
    });

    events.push(event);
  }

  return {
    events,
    warnings,
    stats: {
      totalParsed: parseResult.messages.length,
      eventsCreated: events.length,
      skipped,
    },
  };
}

// ─── Legacy compatibility wrapper (used by US-005 tests) ────

export function writeEventsToLedger(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  events: ContinuumEvent[],
): void {
  const ledger = openLedger(workspaceRoot, projectId, sessionId);
  ledger.appendBatch(events);
}

// ─── End-to-end import ──────────────────────────────────────

export function importTranscript(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  parseResult: ParseResult,
  source: string,
): ImportResult {
  const ledger = openLedger(workspaceRoot, projectId, sessionId);
  const startSequence = ledger.lastSequence() + 1;

  const { events, warnings, stats } = normalizeToEvents({
    parseResult,
    projectId,
    sessionId,
    source,
    startSequence,
  });

  let appendedCount = 0;
  let duplicatesSkipped = 0;

  if (events.length > 0) {
    const batchResult = ledger.appendBatch(events);
    appendedCount = batchResult.appended;
    duplicatesSkipped = batchResult.duplicatesSkipped;

    for (const err of batchResult.errors) {
      warnings.push({
        type: WarningTypes.INACCESSIBLE,
        field: `event[${err.eventId}]`,
        message: err.error ?? `Failed to append event (status: ${err.status}).`,
      });
    }
  }

  updateSessionEventCount(workspaceRoot, projectId, sessionId, appendedCount);

  return {
    eventCount: appendedCount,
    warnings,
    stats: {
      totalParsed: stats.totalParsed,
      eventsCreated: appendedCount,
      skipped: stats.skipped + duplicatesSkipped,
      warningCount: warnings.length,
    },
  };
}

function updateSessionEventCount(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  newEvents: number,
): void {
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
    // Non-fatal: event count is informational
  }
}
