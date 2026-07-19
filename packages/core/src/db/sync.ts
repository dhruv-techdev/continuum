/**
 * Synchronization between the filesystem stores and SQLite.
 *
 * The JSONL ledger and JSON manifests remain the source of truth.
 * This module indexes their contents into SQLite for fast queries.
 */

import type { MetadataDB } from './database';
import type { Project } from '../projects/types';
import type { Session } from '../projects/types';
import type { ContinuumEvent } from '../events/types';
import type { ArtifactEntry } from '../artifacts/types';

// ─── Projects ───────────────────────────────────────────────

export function syncProject(db: MetadataDB, project: Project): void {
  const now = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO projects (id, title, description, created_at, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
  `).run(project.id, project.title, project.description, project.createdAt, project.updatedAt, now);
}

export function syncProjects(db: MetadataDB, projects: Project[]): void {
  db.transaction(() => {
    for (const project of projects) {
      syncProject(db, project);
    }
  });
}

// ─── Sessions ───────────────────────────────────────────────

export function syncSession(db: MetadataDB, session: Session): void {
  const now = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO sessions (id, project_id, provider, model, status, started_at, closed_at, event_count, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      closed_at = excluded.closed_at,
      event_count = excluded.event_count,
      synced_at = excluded.synced_at
  `).run(
    session.id, session.projectId, session.provider, session.model,
    session.status, session.startedAt, session.closedAt, session.eventCount, now,
  );
}

export function syncSessions(db: MetadataDB, sessions: Session[]): void {
  db.transaction(() => {
    for (const session of sessions) {
      syncSession(db, session);
    }
  });
}

// ─── Events (ST2) ───────────────────────────────────────────

export function syncEvent(db: MetadataDB, event: ContinuumEvent): void {
  const now = new Date().toISOString();

  db.db.prepare(`
    INSERT OR IGNORE INTO events
      (id, project_id, session_id, type, sequence, timestamp, source, hash, schema_version, payload_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.projectId, event.sessionId, event.type,
    event.sequence, event.timestamp, event.source, event.hash,
    event.schemaVersion, JSON.stringify(event.payload), now,
  );
}

export function syncEvents(db: MetadataDB, events: ContinuumEvent[]): void {
  const stmt = db.db.prepare(`
    INSERT OR IGNORE INTO events
      (id, project_id, session_id, type, sequence, timestamp, source, hash, schema_version, payload_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  db.transaction(() => {
    for (const event of events) {
      stmt.run(
        event.id, event.projectId, event.sessionId, event.type,
        event.sequence, event.timestamp, event.source, event.hash,
        event.schemaVersion, JSON.stringify(event.payload), now,
      );
    }
  });
}

// ─── Sync watermark (ST2 + ST3) ─────────────────────────────

export function getWatermark(db: MetadataDB, sessionId: string): number {
  const row = db.db.prepare(
    'SELECT last_sequence FROM sync_watermarks WHERE session_id = ?'
  ).get(sessionId) as { last_sequence: number } | undefined;

  return row?.last_sequence ?? -1;
}

export function setWatermark(db: MetadataDB, sessionId: string, lastSequence: number): void {
  const now = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO sync_watermarks (session_id, last_sequence, last_synced)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      last_sequence = excluded.last_sequence,
      last_synced = excluded.last_synced
  `).run(sessionId, lastSequence, now);
}

// ─── Artifacts ──────────────────────────────────────────────

export function syncArtifact(db: MetadataDB, artifact: ArtifactEntry): void {
  const now = new Date().toISOString();

  db.db.prepare(`
    INSERT INTO artifacts
      (id, project_id, uri, file_name, mime_type, size, hash, version,
       storage_mode, stored_path, description, status, registered_at, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at
  `).run(
    artifact.id, artifact.projectId, artifact.uri, artifact.fileName,
    artifact.mimeType, artifact.size, artifact.hash, artifact.version,
    artifact.storageMode, artifact.storedPath, artifact.description,
    artifact.status, artifact.registeredAt, artifact.updatedAt, now,
  );

  // Sync event links
  if (artifact.linkedEventIds.length > 0) {
    const linkStmt = db.db.prepare(
      'INSERT OR IGNORE INTO artifact_events (artifact_id, event_id) VALUES (?, ?)'
    );

    for (const eventId of artifact.linkedEventIds) {
      linkStmt.run(artifact.id, eventId);
    }
  }
}

export function syncArtifacts(db: MetadataDB, artifacts: ArtifactEntry[]): void {
  db.transaction(() => {
    for (const artifact of artifacts) {
      syncArtifact(db, artifact);
    }
  });
}

// ─── Queries ────────────────────────────────────────────────

export function countEvents(db: MetadataDB, sessionId: string): number {
  const row = db.db.prepare(
    'SELECT COUNT(*) as count FROM events WHERE session_id = ?'
  ).get(sessionId) as { count: number };
  return row.count;
}

export function countAllEvents(db: MetadataDB, projectId: string): number {
  const row = db.db.prepare(
    'SELECT COUNT(*) as count FROM events WHERE project_id = ?'
  ).get(projectId) as { count: number };
  return row.count;
}

export function searchEvents(
  db: MetadataDB,
  projectId: string,
  query: { type?: string; source?: string; after?: string; before?: string; limit?: number },
): ContinuumEvent[] {
  const conditions: string[] = ['project_id = ?'];
  const params: unknown[] = [projectId];

  if (query.type) {
    conditions.push('type = ?');
    params.push(query.type);
  }
  if (query.source) {
    conditions.push('source = ?');
    params.push(query.source);
  }
  if (query.after) {
    conditions.push('timestamp > ?');
    params.push(query.after);
  }
  if (query.before) {
    conditions.push('timestamp < ?');
    params.push(query.before);
  }

  const limit = query.limit ?? 100;
  const sql = `
    SELECT id, project_id, session_id, type, sequence, timestamp, source, hash, schema_version, payload_json
    FROM events
    WHERE ${conditions.join(' AND ')}
    ORDER BY sequence ASC
    LIMIT ?
  `;
  params.push(limit);

  const rows = db.db.prepare(sql).all(...params) as Array<{
    id: string; project_id: string; session_id: string; type: string;
    sequence: number; timestamp: string; source: string; hash: string;
    schema_version: string; payload_json: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    type: row.type,
    sequence: row.sequence,
    timestamp: row.timestamp,
    source: row.source,
    hash: row.hash,
    schemaVersion: row.schema_version,
    payload: JSON.parse(row.payload_json),
  })) as ContinuumEvent[];
}
