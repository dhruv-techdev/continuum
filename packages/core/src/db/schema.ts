/**
 * SQLite schema for the Continuum metadata database.
 *
 * The JSONL ledger remains the immutable source of truth.
 * This database is a regenerable, searchable index over
 * projects, sessions, events, and artifacts.
 *
 * Every table includes a `synced_at` timestamp so recovery
 * can determine what needs re-indexing (ST3).
 */

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  synced_at   TEXT NOT NULL
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'unknown',
  model       TEXT NOT NULL DEFAULT 'unknown',
  status      TEXT NOT NULL DEFAULT 'active',
  started_at  TEXT NOT NULL,
  closed_at   TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  synced_at   TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON sessions(status);

-- Events (searchable index over the JSONL ledger)
CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  type           TEXT NOT NULL,
  sequence       INTEGER NOT NULL,
  timestamp      TEXT NOT NULL,
  source         TEXT NOT NULL,
  hash           TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  synced_at      TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_sequence  ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_source    ON events(source);

-- Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  uri             TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size            INTEGER NOT NULL DEFAULT 0,
  hash            TEXT NOT NULL DEFAULT '',
  version         INTEGER NOT NULL DEFAULT 1,
  storage_mode    TEXT NOT NULL DEFAULT 'reference',
  stored_path     TEXT,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active',
  registered_at   TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  synced_at       TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_uri     ON artifacts(uri);
CREATE INDEX IF NOT EXISTS idx_artifacts_status  ON artifacts(status);

-- Artifact ↔ event links
CREATE TABLE IF NOT EXISTS artifact_events (
  artifact_id TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  PRIMARY KEY (artifact_id, event_id),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Sync watermark: tracks last synced sequence per session
CREATE TABLE IF NOT EXISTS sync_watermarks (
  session_id    TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT -1,
  last_synced   TEXT NOT NULL
);
`;
