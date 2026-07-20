/**
 * SQLite database manager.
 *
 * Opens (or creates) the metadata database at a predictable
 * path inside the workspace, runs migrations, and exposes
 * the raw connection for query modules.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { CREATE_TABLES, SCHEMA_VERSION } from './schema';

const DB_FILENAME = 'continuum.db';

export function dbPath(workspaceRoot: string): string {
  return join(workspaceRoot, DB_FILENAME);
}

export class MetadataDB {
  readonly path: string;
  readonly db: DatabaseType;

  constructor(workspaceRoot: string) {
    this.path = dbPath(workspaceRoot);

    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.path);

    // Performance settings for local use
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');

    this.migrate();
  }

  private migrate(): void {
    this.db.exec(CREATE_TABLES);

    const row = this.db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;

    if (!row) {
      this.db
        .prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)")
        .run(String(SCHEMA_VERSION));
    }
  }

  close(): void {
    this.db.close();
  }

  /**
   * Run a function inside a transaction. If it throws,
   * the transaction is rolled back automatically.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

// ─── Singleton per workspace ────────────────────────────────

const instances = new Map<string, MetadataDB>();

export function openDB(workspaceRoot: string): MetadataDB {
  let instance = instances.get(workspaceRoot);
  if (instance) return instance;

  instance = new MetadataDB(workspaceRoot);
  instances.set(workspaceRoot, instance);
  return instance;
}

export function closeDB(workspaceRoot: string): void {
  const instance = instances.get(workspaceRoot);
  if (instance) {
    instance.close();
    instances.delete(workspaceRoot);
  }
}

export function closeAllDBs(): void {
  for (const [key, instance] of instances) {
    instance.close();
    instances.delete(key);
  }
}
