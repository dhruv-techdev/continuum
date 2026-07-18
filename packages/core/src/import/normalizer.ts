/**
 * Normalizer: ParsedMessage[] → ContinuumEvent[]
 *
 * Maps parsed role strings to canonical MessageRole,
 * creates events via the factory, and writes them to
 * the session's event ledger on disk.
 */

import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ParseResult, ImportResult, ImportWarning } from './types';
import { WarningTypes } from './types';
import { createEvent, EventTypes, MessageRoles } from '../events/index';
import type { MessageRole, ContinuumEvent } from '../events/types';

// ─── Role mapping ───────────────────────────────────────────

const ROLE_MAP: Record<string, MessageRole> = {
  user: MessageRoles.USER,
  assistant: MessageRoles.ASSISTANT,
  system: MessageRoles.SYSTEM,
};

function mapRole(parsed: string, index: number, warnings: ImportWarning[]): MessageRole | null {
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
  const { parseResult, projectId, sessionId, source } = input;
  const warnings: ImportWarning[] = [...parseResult.warnings];
  const events: ContinuumEvent[] = [];
  let skipped = 0;

  for (let i = 0; i < parseResult.messages.length; i++) {
    const msg = parseResult.messages[i];

    const role = mapRole(msg.role, i, warnings);
    if (!role) {
      skipped++;
      continue;
    }

    const metadata: Record<string, unknown> = {};

    // Preserve unmapped fields in metadata
    if (Object.keys(msg.unmappedFields).length > 0) {
      metadata.originalFields = msg.unmappedFields;
    }

    // Preserve original role if it was coerced
    if (!ROLE_MAP[msg.role]) {
      metadata.originalRole = msg.role;
    }

    // Preserve detected provider
    if (parseResult.detectedProvider) {
      metadata.detectedProvider = parseResult.detectedProvider;
    }

    const event = createEvent({
      type: EventTypes.MESSAGE,
      projectId,
      sessionId,
      sequence: i,
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

// ─── Write events to ledger ─────────────────────────────────

export function writeEventsToLedger(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  events: ContinuumEvent[],
): void {
  const sessionDir = join(workspaceRoot, 'projects', projectId, 'sessions', sessionId);
  const ledgerPath = join(sessionDir, 'events.jsonl');

  const lines = events.map((e) => JSON.stringify(e)).join('\n');

  if (existsSync(ledgerPath)) {
    appendFileSync(ledgerPath, lines + '\n', 'utf-8');
  } else {
    writeFileSync(ledgerPath, lines + '\n', 'utf-8');
  }
}

// ─── End-to-end import ──────────────────────────────────────

export function importTranscript(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
  parseResult: ParseResult,
  source: string,
): ImportResult {
  const { events, warnings, stats } = normalizeToEvents({
    parseResult,
    projectId,
    sessionId,
    source,
  });

  if (events.length > 0) {
    writeEventsToLedger(workspaceRoot, projectId, sessionId, events);
  }

  // Update session eventCount
  updateSessionEventCount(workspaceRoot, projectId, sessionId, events.length);

  return {
    eventCount: events.length,
    warnings,
    stats: {
      ...stats,
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
