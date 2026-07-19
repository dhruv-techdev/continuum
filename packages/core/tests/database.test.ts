import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  startSession,
  openDB,
  closeDB,
  dbPath,
  syncProject,
  syncSession,
  syncEvent,
  syncEvents,
  getWatermark,
  setWatermark,
  syncArtifact,
  countEvents,
  countAllEvents,
  searchEvents,
  recoverSession,
  recoverWorkspace,
  createEvent,
  EventTypes,
  MessageRoles,
  openLedger,
  registerArtifact,
} from '../src/index';
import type { MetadataDB } from '../src/db/database';
import type { ContinuumEvent, MessageEvent } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';

function msg(pid: string, sid: string, seq: number, content: string): MessageEvent {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: pid, sessionId: sid, sequence: seq,
    source: 'test', timestamp: TS,
    payload: { role: MessageRoles.USER, content },
  });
}

describe('MetadataDB', () => {
  let root: string;
  let db: MetadataDB;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-db-test-'));
    initWorkspace(root);
    db = openDB(root);
  });

  afterEach(() => {
    closeDB(root);
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Tables exist ───────────────────────────────────

  describe('ST1 — SQLite tables', () => {
    it('should create the database file', () => {
      expect(existsSync(dbPath(root))).toBe(true);
    });

    it('should create all required tables', () => {
      const tables = db.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all() as Array<{ name: string }>;

      const names = tables.map((t) => t.name).sort();
      expect(names).toContain('projects');
      expect(names).toContain('sessions');
      expect(names).toContain('events');
      expect(names).toContain('artifacts');
      expect(names).toContain('artifact_events');
      expect(names).toContain('sync_watermarks');
      expect(names).toContain('schema_meta');
    });

    it('should store schema version', () => {
      const row = db.db.prepare(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
      ).get() as { value: string };
      expect(row.value).toBe('1');
    });

    it('should sync a project', () => {
      const proj = createProject(root, { title: 'DB Test' }).data!;
      syncProject(db, proj);

      const row = db.db.prepare('SELECT * FROM projects WHERE id = ?').get(proj.id) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.title).toBe('DB Test');
    });

    it('should sync a session', () => {
      const proj = createProject(root, { title: 'S Test' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;

      syncProject(db, proj);
      syncSession(db, sess);

      const row = db.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sess.id) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.project_id).toBe(proj.id);
    });

    it('should sync events', () => {
      const proj = createProject(root, { title: 'E Test' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;

      syncProject(db, proj);
      syncSession(db, sess);

      const events = [
        msg(proj.id, sess.id, 0, 'hello'),
        msg(proj.id, sess.id, 1, 'world'),
      ];
      syncEvents(db, events);

      expect(countEvents(db, sess.id)).toBe(2);
    });

    it('should sync artifacts', () => {
      const proj = createProject(root, { title: 'A Test' }).data!;
      syncProject(db, proj);

      const testFile = join(root, 'test.ts');
      writeFileSync(testFile, 'export default 42;', 'utf-8');

      const reg = registerArtifact(root, { projectId: proj.id, uri: testFile });
      syncArtifact(db, reg.artifact!);

      const row = db.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(reg.artifact!.id) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.file_name).toBe('test.ts');
    });
  });

  // ── ST2: Synchronized writes ────────────────────────────

  describe('ST2 — Synchronized metadata', () => {
    it('should use INSERT OR IGNORE to skip duplicate events', () => {
      const proj = createProject(root, { title: 'Dup Test' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, sess);

      const event = msg(proj.id, sess.id, 0, 'single');
      syncEvent(db, event);
      syncEvent(db, event); // duplicate

      expect(countEvents(db, sess.id)).toBe(1);
    });

    it('should track watermarks', () => {
      expect(getWatermark(db, 'sess_new')).toBe(-1);

      setWatermark(db, 'sess_new', 5);
      expect(getWatermark(db, 'sess_new')).toBe(5);

      setWatermark(db, 'sess_new', 10);
      expect(getWatermark(db, 'sess_new')).toBe(10);
    });

    it('should upsert projects on re-sync', () => {
      const proj = createProject(root, { title: 'Original' }).data!;
      syncProject(db, proj);

      const updated = { ...proj, title: 'Updated' };
      syncProject(db, updated);

      const row = db.db.prepare('SELECT title FROM projects WHERE id = ?').get(proj.id) as { title: string };
      expect(row.title).toBe('Updated');
    });

    it('should search events by type', () => {
      const proj = createProject(root, { title: 'Search' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, sess);

      const events = [
        msg(proj.id, sess.id, 0, 'user msg'),
        createEvent({
          type: EventTypes.SYSTEM,
          projectId: proj.id, sessionId: sess.id, sequence: 1,
          source: 'test', timestamp: TS,
          payload: { action: 'checkpoint' as const },
        }),
      ];
      syncEvents(db, events);

      const messages = searchEvents(db, proj.id, { type: 'message' });
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('message');

      const all = searchEvents(db, proj.id, {});
      expect(all).toHaveLength(2);
    });

    it('should search events by source', () => {
      const proj = createProject(root, { title: 'Src' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, sess);

      const e0 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: proj.id, sessionId: sess.id, sequence: 0,
        source: 'import:file.json', timestamp: TS,
        payload: { role: MessageRoles.USER, content: 'imported' },
      });
      const e1 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: proj.id, sessionId: sess.id, sequence: 1,
        source: 'cli', timestamp: TS,
        payload: { role: MessageRoles.USER, content: 'manual' },
      });
      syncEvents(db, [e0, e1]);

      const results = searchEvents(db, proj.id, { source: 'cli' });
      expect(results).toHaveLength(1);
    });

    it('should count events per project', () => {
      const proj = createProject(root, { title: 'Count' }).data!;
      const s1 = startSession(root, { projectId: proj.id }).data!;
      const s2 = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, s1);
      syncSession(db, s2);

      syncEvents(db, [msg(proj.id, s1.id, 0, 'a'), msg(proj.id, s1.id, 1, 'b')]);
      syncEvents(db, [msg(proj.id, s2.id, 0, 'c')]);

      expect(countAllEvents(db, proj.id)).toBe(3);
      expect(countEvents(db, s1.id)).toBe(2);
      expect(countEvents(db, s2.id)).toBe(1);
    });
  });

  // ── ST3: Recovery ───────────────────────────────────────

  describe('ST3 — Recovery after interrupted ingestion', () => {
    it('should recover events written to ledger but not synced', () => {
      const proj = createProject(root, { title: 'Recovery' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, sess);

      // Write events to the JSONL ledger directly
      const ledger = openLedger(root, proj.id, sess.id);
      ledger.append(msg(proj.id, sess.id, 0, 'before crash'));
      ledger.append(msg(proj.id, sess.id, 1, 'also before crash'));

      // Database has no events — simulates a crash
      expect(countEvents(db, sess.id)).toBe(0);

      // Recovery should find and sync them
      const result = recoverSession(db, root, proj.id, sess.id);

      expect(result.eventsRecovered).toBe(2);
      expect(result.error).toBeNull();
      expect(countEvents(db, sess.id)).toBe(2);
      expect(getWatermark(db, sess.id)).toBe(1);
    });

    it('should only recover events beyond the watermark', () => {
      const proj = createProject(root, { title: 'Partial' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, sess);

      const ledger = openLedger(root, proj.id, sess.id);
      const e0 = msg(proj.id, sess.id, 0, 'already synced');
      const e1 = msg(proj.id, sess.id, 1, 'already synced too');
      const e2 = msg(proj.id, sess.id, 2, 'new after crash');

      ledger.append(e0);
      ledger.append(e1);
      ledger.append(e2);

      // Simulate: first two were synced before crash
      syncEvents(db, [e0, e1]);
      setWatermark(db, sess.id, 1);

      // Recovery should only sync e2
      const result = recoverSession(db, root, proj.id, sess.id);

      expect(result.eventsRecovered).toBe(1);
      expect(countEvents(db, sess.id)).toBe(3);
      expect(getWatermark(db, sess.id)).toBe(2);
    });

    it('should handle fresh database with existing data', () => {
      const proj = createProject(root, { title: 'Fresh DB' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;

      const ledger = openLedger(root, proj.id, sess.id);
      ledger.append(msg(proj.id, sess.id, 0, 'existing'));
      ledger.append(msg(proj.id, sess.id, 1, 'existing too'));

      // Full workspace recovery
      const result = recoverWorkspace(db, root);

      expect(result.projectsSynced).toBeGreaterThanOrEqual(1);
      expect(result.sessionsSynced).toBeGreaterThanOrEqual(1);
      expect(result.eventsRecovered).toBe(2);
    });

    it('should be idempotent — re-running recovery changes nothing', () => {
      const proj = createProject(root, { title: 'Idempotent' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;

      const ledger = openLedger(root, proj.id, sess.id);
      ledger.append(msg(proj.id, sess.id, 0, 'once'));

      recoverWorkspace(db, root);
      const first = countEvents(db, sess.id);

      recoverWorkspace(db, root);
      const second = countEvents(db, sess.id);

      expect(first).toBe(1);
      expect(second).toBe(1);
    });

    it('should recover multiple sessions across projects', () => {
      const p1 = createProject(root, { title: 'P1' }).data!;
      const p2 = createProject(root, { title: 'P2' }).data!;
      const s1 = startSession(root, { projectId: p1.id }).data!;
      const s2 = startSession(root, { projectId: p2.id }).data!;

      const l1 = openLedger(root, p1.id, s1.id);
      l1.append(msg(p1.id, s1.id, 0, 'p1 msg'));

      const l2 = openLedger(root, p2.id, s2.id);
      l2.append(msg(p2.id, s2.id, 0, 'p2 msg 1'));
      l2.append(msg(p2.id, s2.id, 1, 'p2 msg 2'));

      const result = recoverWorkspace(db, root);

      expect(result.projectsSynced).toBe(2);
      expect(result.sessionsSynced).toBe(2);
      expect(result.eventsRecovered).toBe(3);
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty workspace', () => {
      const result = recoverWorkspace(db, root);
      expect(result.projectsSynced).toBe(0);
      expect(result.eventsRecovered).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle session with no events', () => {
      const proj = createProject(root, { title: 'Empty' }).data!;
      startSession(root, { projectId: proj.id });

      const result = recoverWorkspace(db, root);
      expect(result.sessionsSynced).toBe(1);
      expect(result.eventsRecovered).toBe(0);
    });

    it('should use transactions for batch sync', () => {
      const proj = createProject(root, { title: 'Tx Test' }).data!;
      const sess = startSession(root, { projectId: proj.id }).data!;
      syncProject(db, proj);
      syncSession(db, sess);

      const events: ContinuumEvent[] = [];
      for (let i = 0; i < 100; i++) {
        events.push(msg(proj.id, sess.id, i, `event-${i}`));
      }
      syncEvents(db, events);

      expect(countEvents(db, sess.id)).toBe(100);
    });
  });
});
