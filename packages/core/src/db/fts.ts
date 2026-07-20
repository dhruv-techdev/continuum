/**
 * Full-text search index using SQLite FTS5.
 *
 * The FTS index stores the text content of events alongside
 * their metadata so that exact-text search returns rich results
 * with source IDs, timestamps, types, and matching excerpts.
 *
 * Content is extracted from event payloads:
 *   - message: payload.content
 *   - tool_call: payload.toolName + JSON(payload.input)
 *   - tool_result: payload.toolName + payload.output
 *   - command: payload.command
 *   - command_output: payload.stdout + payload.stderr
 *   - artifact: payload.uri + payload.description
 *   - system: payload.action + payload.message
 */

import type { MetadataDB } from './database';
import type { ContinuumEvent } from '../events/types';

// ─── ST1: Create FTS index ──────────────────────────────────

export const CREATE_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  event_id,
  project_id,
  session_id,
  type,
  timestamp,
  source,
  content,
  tokenize='porter unicode61'
);
`;

export function ensureFTS(db: MetadataDB): void {
  db.db.exec(CREATE_FTS);
}

// ─── Extract searchable text from event payload ─────────────

export function extractContent(event: ContinuumEvent): string {
  const payload = event.payload as unknown as Record<string, unknown>;

  switch (event.type) {
    case 'message':
      return (payload.content as string) ?? '';

    case 'tool_call': {
      const name = (payload.toolName as string) ?? '';
      const input = payload.input ? JSON.stringify(payload.input) : '';
      return `${name} ${input}`.trim();
    }

    case 'tool_result': {
      const name = (payload.toolName as string) ?? '';
      const output = (payload.output as string) ?? '';
      const isError = payload.isError ? ' [error]' : '';
      return `${name} ${output}${isError}`.trim();
    }

    case 'command':
      return (payload.command as string) ?? '';

    case 'command_output': {
      const stdout = (payload.stdout as string) ?? '';
      const stderr = (payload.stderr as string) ?? '';
      return `${stdout} ${stderr}`.trim();
    }

    case 'artifact': {
      const uri = (payload.uri as string) ?? '';
      const desc = (payload.description as string) ?? '';
      return `${uri} ${desc}`.trim();
    }

    case 'system': {
      const action = (payload.action as string) ?? '';
      const message = (payload.message as string) ?? '';
      return `${action} ${message}`.trim();
    }

    default:
      return '';
  }
}

// ─── Index events into FTS ──────────────────────────────────

function isIndexed(db: MetadataDB, eventId: string): boolean {
  const row = db.db.prepare('SELECT 1 FROM events_fts WHERE event_id = ? LIMIT 1').get(eventId);
  return row !== undefined;
}

export function indexEvent(db: MetadataDB, event: ContinuumEvent): void {
  ensureFTS(db);

  const content = extractContent(event);
  if (content.length === 0) return;
  if (isIndexed(db, event.id)) return;

  db.db
    .prepare(
      `
    INSERT INTO events_fts (event_id, project_id, session_id, type, timestamp, source, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      event.id,
      event.projectId,
      event.sessionId,
      event.type,
      event.timestamp,
      event.source,
      content,
    );
}

export function indexEvents(db: MetadataDB, events: ContinuumEvent[]): void {
  ensureFTS(db);

  const stmt = db.db.prepare(`
    INSERT INTO events_fts (event_id, project_id, session_id, type, timestamp, source, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const event of events) {
      const content = extractContent(event);
      if (content.length === 0) continue;
      if (isIndexed(db, event.id)) continue;
      stmt.run(
        event.id,
        event.projectId,
        event.sessionId,
        event.type,
        event.timestamp,
        event.source,
        content,
      );
    }
  });
}

// ─── ST2 + ST3: Search with results ─────────────────────────

export interface SearchResult {
  /** Source event ID (ST3) */
  eventId: string;
  projectId: string;
  sessionId: string;
  /** Event type (ST3) */
  type: string;
  /** Event timestamp (ST3) */
  timestamp: string;
  source: string;
  /** Full content of the indexed text */
  content: string;
  /** FTS5 snippet with match highlighting (ST3) */
  excerpt: string;
  /** BM25 relevance score (lower is more relevant) */
  rank: number;
}

export interface SearchOptions {
  projectId: string;
  query: string;
  /** Filter by event type */
  type?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by source */
  sourceFilter?: string;
  /** Only events after this timestamp */
  after?: string;
  /** Only events before this timestamp */
  before?: string;
  /** Max results (default 20) */
  limit?: number;
}

/**
 * Escape a user-supplied query for FTS5 MATCH. Wraps each token (or
 * pre-quoted phrase) in double quotes so characters with special meaning
 * to the FTS5 query syntax (e.g. '-', ':') are treated literally.
 */
export function sanitizeFtsQuery(query: string): string {
  const tokens = query.match(/"[^"]*"|\S+/g) ?? [];
  return tokens
    .map((token) => {
      if (token.startsWith('"') && token.endsWith('"') && token.length > 1) {
        return token;
      }
      return `"${token.replace(/"/g, '""')}"`;
    })
    .join(' ');
}

export function search(db: MetadataDB, options: SearchOptions): SearchResult[] {
  ensureFTS(db);

  const conditions: string[] = ['events_fts.project_id = ?'];
  const params: unknown[] = [options.projectId];

  // FTS5 match query
  conditions.push('events_fts MATCH ?');
  params.push(sanitizeFtsQuery(options.query));

  if (options.type) {
    conditions.push('events_fts.type = ?');
    params.push(options.type);
  }

  if (options.sessionId) {
    conditions.push('events_fts.session_id = ?');
    params.push(options.sessionId);
  }

  if (options.sourceFilter) {
    conditions.push('events_fts.source = ?');
    params.push(options.sourceFilter);
  }

  if (options.after) {
    conditions.push('events_fts.timestamp > ?');
    params.push(options.after);
  }

  if (options.before) {
    conditions.push('events_fts.timestamp < ?');
    params.push(options.before);
  }

  const limit = options.limit ?? 20;
  params.push(limit);

  const sql = `
    SELECT
      event_id,
      project_id,
      session_id,
      type,
      timestamp,
      source,
      content,
      snippet(events_fts, 6, '>>>', '<<<', '…', 40) as excerpt,
      rank
    FROM events_fts
    WHERE ${conditions.join(' AND ')}
    ORDER BY rank
    LIMIT ?
  `;

  const rows = db.db.prepare(sql).all(...params) as Array<{
    event_id: string;
    project_id: string;
    session_id: string;
    type: string;
    timestamp: string;
    source: string;
    content: string;
    excerpt: string;
    rank: number;
  }>;

  return rows.map((row) => ({
    eventId: row.event_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    type: row.type,
    timestamp: row.timestamp,
    source: row.source,
    content: row.content,
    excerpt: row.excerpt,
    rank: row.rank,
  }));
}

// ─── Count FTS entries ──────────────────────────────────────

export function countIndexed(db: MetadataDB, projectId: string): number {
  ensureFTS(db);

  const row = db.db
    .prepare('SELECT COUNT(*) as count FROM events_fts WHERE project_id = ?')
    .get(projectId) as { count: number };

  return row.count;
}
