import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  startSession,
  openDB,
  closeDB,
  syncProject,
  syncSession,
  ensureFTS,
  extractContent,
  indexEvent,
  indexEvents,
  search,
  countIndexed,
  recoverWorkspace,
  createEvent,
  EventTypes,
  MessageRoles,
  ArtifactActions,
  SystemActions,
  openLedger,
} from '../src/index';
import type { MetadataDB, ContinuumEvent } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';

function msg(pid: string, sid: string, seq: number, role: 'user' | 'assistant', content: string): ContinuumEvent {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: pid, sessionId: sid, sequence: seq,
    source: 'test', timestamp: TS,
    payload: { role: role === 'user' ? MessageRoles.USER : MessageRoles.ASSISTANT, content },
  });
}

describe('extractContent()', () => {
  it('should extract message content', () => {
    const event = msg('p', 's', 0, 'user', 'Hello world');
    expect(extractContent(event)).toBe('Hello world');
  });

  it('should extract tool_call name and input', () => {
    const event = createEvent({
      type: EventTypes.TOOL_CALL,
      projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS,
      payload: { toolName: 'web_search', input: { query: 'TypeScript monorepo' } },
    });
    const content = extractContent(event);
    expect(content).toContain('web_search');
    expect(content).toContain('TypeScript monorepo');
  });

  it('should extract tool_result output', () => {
    const event = createEvent({
      type: EventTypes.TOOL_RESULT,
      projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS,
      payload: { toolName: 'web_search', output: 'Found 5 results', isError: false },
    });
    expect(extractContent(event)).toContain('Found 5 results');
  });

  it('should extract command text', () => {
    const event = createEvent({
      type: EventTypes.COMMAND,
      projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS,
      payload: { command: 'npm run build' },
    });
    expect(extractContent(event)).toBe('npm run build');
  });

  it('should extract command_output stdout and stderr', () => {
    const event = createEvent({
      type: EventTypes.COMMAND_OUTPUT,
      projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS,
      payload: { commandEventId: 'e1', stdout: '42 tests passed', stderr: '1 warning' },
    });
    const content = extractContent(event);
    expect(content).toContain('42 tests passed');
    expect(content).toContain('1 warning');
  });

  it('should extract artifact URI and description', () => {
    const event = createEvent({
      type: EventTypes.ARTIFACT,
      projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS,
      payload: { action: ArtifactActions.CREATE, uri: '/app/main.ts', description: 'Entry point' },
    });
    const content = extractContent(event);
    expect(content).toContain('main.ts');
    expect(content).toContain('Entry point');
  });

  it('should extract system action and message', () => {
    const event = createEvent({
      type: EventTypes.SYSTEM,
      projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS,
      payload: { action: SystemActions.CHECKPOINT, message: 'Before major refactor' },
    });
    const content = extractContent(event);
    expect(content).toContain('checkpoint');
    expect(content).toContain('refactor');
  });
});

describe('FTS search', () => {
  let root: string;
  let db: MetadataDB;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-fts-test-'));
    initWorkspace(root);
    db = openDB(root);
    ensureFTS(db);

    const proj = createProject(root, { title: 'FTS Test' }).data!;
    projectId = proj.id;
    syncProject(db, proj);

    const sess = startSession(root, { projectId }).data!;
    sessionId = sess.id;
    syncSession(db, sess);
  });

  afterEach(() => {
    closeDB(root);
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Full-text index ────────────────────────────────

  describe('ST1 — indexing', () => {
    it('should index events and count them', () => {
      const events = [
        msg(projectId, sessionId, 0, 'user', 'How do I set up a monorepo?'),
        msg(projectId, sessionId, 1, 'assistant', 'Use pnpm workspaces with a shared tsconfig.'),
        msg(projectId, sessionId, 2, 'user', 'What about error handling?'),
      ];
      indexEvents(db, events);

      expect(countIndexed(db, projectId)).toBe(3);
    });

    it('should index all event types', () => {
      const events: ContinuumEvent[] = [
        msg(projectId, sessionId, 0, 'user', 'Search test'),
        createEvent({
          type: EventTypes.TOOL_CALL,
          projectId, sessionId, sequence: 1, source: 'test', timestamp: TS,
          payload: { toolName: 'calculator', input: { expression: '2+2' } },
        }),
        createEvent({
          type: EventTypes.COMMAND,
          projectId, sessionId, sequence: 2, source: 'test', timestamp: TS,
          payload: { command: 'git status' },
        }),
      ];
      indexEvents(db, events);

      expect(countIndexed(db, projectId)).toBe(3);
    });

    it('should skip events with empty content', () => {
      const event = msg(projectId, sessionId, 0, 'user', '');
      indexEvent(db, event);

      expect(countIndexed(db, projectId)).toBe(0);
    });

    it('should not duplicate on re-index', () => {
      const event = msg(projectId, sessionId, 0, 'user', 'unique message');
      indexEvent(db, event);
      indexEvent(db, event);

      expect(countIndexed(db, projectId)).toBe(1);
    });
  });

  // ── ST2: Search command ─────────────────────────────────

  describe('ST2 — search queries', () => {
    beforeEach(() => {
      const events = [
        msg(projectId, sessionId, 0, 'user', 'I want to build a TypeScript monorepo for event sourcing'),
        msg(projectId, sessionId, 1, 'assistant', 'Use pnpm workspaces. Create a pnpm-workspace.yaml file at the root.'),
        msg(projectId, sessionId, 2, 'user', 'The system must preserve event ordering without modification.'),
        msg(projectId, sessionId, 3, 'user', 'I decided to use JSONL for the append-only ledger format.'),
        msg(projectId, sessionId, 4, 'assistant', 'Done. I have implemented SHA-256 hash verification for every event.'),
        msg(projectId, sessionId, 5, 'user', 'I tried using SQLite for the primary store but it failed with linking errors.'),
      ];
      indexEvents(db, events);
    });

    it('should find events matching a single keyword', () => {
      const results = search(db, { projectId, query: 'monorepo' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('monorepo');
    });

    it('should find events matching multiple keywords', () => {
      const results = search(db, { projectId, query: 'SHA-256 hash' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('SHA-256');
    });

    it('should find events matching a phrase', () => {
      const results = search(db, { projectId, query: '"event ordering"' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for non-matching query', () => {
      const results = search(db, { projectId, query: 'kubernetes deployment nginx' });
      expect(results).toHaveLength(0);
    });

    it('should filter by event type', () => {
      const results = search(db, { projectId, query: 'monorepo', type: 'message' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.type).toBe('message');
      }
    });

    it('should filter by session', () => {
      const results = search(db, { projectId, query: 'JSONL', sessionId });
      expect(results.length).toBeGreaterThanOrEqual(1);

      const noResults = search(db, { projectId, query: 'JSONL', sessionId: 'sess_nonexistent' });
      expect(noResults).toHaveLength(0);
    });

    it('should respect limit', () => {
      const results = search(db, { projectId, query: 'the', limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should rank results by relevance', () => {
      const results = search(db, { projectId, query: 'JSONL ledger' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      // The event that mentions both words should rank higher
      expect(results[0].content).toContain('JSONL');
    });
  });

  // ── ST3: Result metadata ────────────────────────────────

  describe('ST3 — result metadata', () => {
    beforeEach(() => {
      indexEvents(db, [
        msg(projectId, sessionId, 0, 'user', 'The goal is to build a context transfer system for AI.'),
      ]);
    });

    it('should return event ID', () => {
      const results = search(db, { projectId, query: 'context transfer' });
      expect(results[0].eventId).toMatch(/^evt_/);
    });

    it('should return timestamp', () => {
      const results = search(db, { projectId, query: 'context transfer' });
      expect(results[0].timestamp).toBe(TS);
    });

    it('should return event type', () => {
      const results = search(db, { projectId, query: 'context transfer' });
      expect(results[0].type).toBe('message');
    });

    it('should return matching excerpt with highlighting', () => {
      const results = search(db, { projectId, query: 'context transfer' });
      expect(results[0].excerpt.length).toBeGreaterThan(0);
      // FTS5 highlights with >>> and <
      expect(results[0].excerpt).toContain('>>>');
      expect(results[0].excerpt).toContain('<<<');
    });

    it('should return source', () => {
      const results = search(db, { projectId, query: 'context transfer' });
      expect(results[0].source).toBe('test');
    });

    it('should return session ID', () => {
      const results = search(db, { projectId, query: 'context transfer' });
      expect(results[0].sessionId).toBe(sessionId);
    });
  });

  // ── Integration with recovery ───────────────────────────

  describe('integration with db sync', () => {
    it('should index events during recoverWorkspace', () => {
      // Write events to ledger (not through DB)
      const ledger = openLedger(root, projectId, sessionId);
      ledger.append(msg(projectId, sessionId, 0, 'user', 'Searchable event from recovery'));

      // Recovery should sync + index
      recoverWorkspace(db, root);

      const results = search(db, { projectId, query: 'Searchable recovery' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
