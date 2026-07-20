/**
 * Timeline retrieval and filtering.
 *
 * Queries the SQLite index for chronological event sequences
 * with filtering by project, session, date range, and event type.
 * Also supports direct retrieval by event ID (ST3).
 */

import type { MetadataDB } from './database';

// ─── Timeline filter options (ST1) ──────────────────────────

export interface TimelineFilter {
  projectId: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by event type(s) */
  types?: string[];
  /** Filter by source */
  source?: string;
  /** Only events after this ISO timestamp */
  after?: string;
  /** Only events before this ISO timestamp */
  before?: string;
  /** Only events with sequence >= this value */
  fromSequence?: number;
  /** Only events with sequence <= this value */
  toSequence?: number;
  /** Limit results (default 100) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order: 'asc' (oldest first) or 'desc' (newest first) */
  order?: 'asc' | 'desc';
}

// ─── Timeline entry with parsed payload ─────────────────────

export interface TimelineEntry {
  id: string;
  projectId: string;
  sessionId: string;
  type: string;
  sequence: number;
  timestamp: string;
  source: string;
  hash: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  /** Human-readable content preview */
  preview: string;
}

// ─── Timeline result ────────────────────────────────────────

export interface TimelineResult {
  entries: TimelineEntry[];
  total: number;
  hasMore: boolean;
  filter: TimelineFilter;
}

// ─── Extract a short preview from payload ───────────────────

function extractPreview(type: string, payload: Record<string, unknown>, maxLen = 120): string {
  let raw = '';

  switch (type) {
    case 'message':
      raw = (payload.content as string) ?? '';
      break;
    case 'tool_call':
      raw = `${payload.toolName}(${JSON.stringify(payload.input ?? {}).slice(0, 60)})`;
      break;
    case 'tool_result': {
      const err = payload.isError ? ' [ERROR]' : '';
      raw = `${payload.toolName}: ${(payload.output as string) ?? ''}${err}`;
      break;
    }
    case 'command':
      raw = `$ ${(payload.command as string) ?? ''}`;
      break;
    case 'command_output': {
      const code = payload.exitCode !== undefined ? `[exit ${payload.exitCode}] ` : '';
      raw = `${code}${(payload.stdout as string) ?? (payload.stderr as string) ?? ''}`;
      break;
    }
    case 'artifact':
      raw = `${payload.action}: ${(payload.uri as string) ?? ''}`;
      break;
    case 'system':
      raw = `${payload.action}${payload.message ? ': ' + payload.message : ''}`;
      break;
    default:
      raw = JSON.stringify(payload).slice(0, maxLen);
  }

  return raw.length > maxLen ? raw.slice(0, maxLen) + '…' : raw;
}

// ─── Parse a DB row into a TimelineEntry ────────────────────

function rowToEntry(row: Record<string, unknown>): TimelineEntry {
  const payload = JSON.parse(row.payload_json as string);

  return {
    id: row.id as string,
    projectId: row.project_id as string,
    sessionId: row.session_id as string,
    type: row.type as string,
    sequence: row.sequence as number,
    timestamp: row.timestamp as string,
    source: row.source as string,
    hash: row.hash as string,
    schemaVersion: row.schema_version as string,
    payload,
    preview: extractPreview(row.type as string, payload),
  };
}

// ─── ST2: Chronological timeline retrieval ──────────────────

export function getTimeline(db: MetadataDB, filter: TimelineFilter): TimelineResult {
  const conditions: string[] = ['project_id = ?'];
  const params: unknown[] = [filter.projectId];

  if (filter.sessionId) {
    conditions.push('session_id = ?');
    params.push(filter.sessionId);
  }

  if (filter.types && filter.types.length > 0) {
    const placeholders = filter.types.map(() => '?').join(', ');
    conditions.push(`type IN (${placeholders})`);
    params.push(...filter.types);
  }

  if (filter.source) {
    conditions.push('source = ?');
    params.push(filter.source);
  }

  if (filter.after) {
    conditions.push('timestamp > ?');
    params.push(filter.after);
  }

  if (filter.before) {
    conditions.push('timestamp < ?');
    params.push(filter.before);
  }

  if (filter.fromSequence !== undefined) {
    conditions.push('sequence >= ?');
    params.push(filter.fromSequence);
  }

  if (filter.toSequence !== undefined) {
    conditions.push('sequence <= ?');
    params.push(filter.toSequence);
  }

  const where = conditions.join(' AND ');
  const order = filter.order === 'desc' ? 'DESC' : 'ASC';
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;

  // Count total matching
  const countRow = db.db
    .prepare(`SELECT COUNT(*) as total FROM events WHERE ${where}`)
    .get(...params) as { total: number };

  const total = countRow.total;

  // Fetch page
  const sql = `
    SELECT id, project_id, session_id, type, sequence, timestamp, source, hash, schema_version, payload_json
    FROM events
    WHERE ${where}
    ORDER BY sequence ${order}
    LIMIT ? OFFSET ?
  `;

  const rows = db.db.prepare(sql).all(...params, limit, offset) as Array<Record<string, unknown>>;

  return {
    entries: rows.map(rowToEntry),
    total,
    hasMore: offset + rows.length < total,
    filter,
  };
}

// ─── ST3: Direct retrieval by event ID ──────────────────────

export function getEventById(db: MetadataDB, eventId: string): TimelineEntry | null {
  const row = db.db
    .prepare(
      `
    SELECT id, project_id, session_id, type, sequence, timestamp, source, hash, schema_version, payload_json
    FROM events
    WHERE id = ?
  `,
    )
    .get(eventId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return rowToEntry(row);
}

// ─── Get multiple events by IDs ─────────────────────────────

export function getEventsByIds(db: MetadataDB, eventIds: string[]): TimelineEntry[] {
  if (eventIds.length === 0) return [];

  const placeholders = eventIds.map(() => '?').join(', ');
  const sql = `
    SELECT id, project_id, session_id, type, sequence, timestamp, source, hash, schema_version, payload_json
    FROM events
    WHERE id IN (${placeholders})
    ORDER BY sequence ASC
  `;

  const rows = db.db.prepare(sql).all(...eventIds) as Array<Record<string, unknown>>;

  return rows.map(rowToEntry);
}

// ─── Get distinct values for filtering UI ───────────────────

export function getDistinctTypes(db: MetadataDB, projectId: string): string[] {
  const rows = db.db
    .prepare('SELECT DISTINCT type FROM events WHERE project_id = ? ORDER BY type')
    .all(projectId) as Array<{ type: string }>;

  return rows.map((r) => r.type);
}

export function getDistinctSources(db: MetadataDB, projectId: string): string[] {
  const rows = db.db
    .prepare('SELECT DISTINCT source FROM events WHERE project_id = ? ORDER BY source')
    .all(projectId) as Array<{ source: string }>;

  return rows.map((r) => r.source);
}

export function getTimeRange(
  db: MetadataDB,
  projectId: string,
): { earliest: string | null; latest: string | null } {
  const row = db.db
    .prepare(
      `
    SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest
    FROM events WHERE project_id = ?
  `,
    )
    .get(projectId) as { earliest: string | null; latest: string | null };

  return row;
}
