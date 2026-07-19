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
  syncEvents,
  ensureFTS,
  indexEvents,
  getTimeline,
  getEventById,
  getEventsByIds,
  getDistinctTypes,
  getDistinctSources,
  getTimeRange,
  createEvent,
  EventTypes,
  MessageRoles,
  SystemActions,
} from '../src/index';
import type { MetadataDB, ContinuumEvent, TimelineEntry } from '../src/index';

const PID = 'proj_tl';
const SID = 'sess_tl';

function makeEvents(): ContinuumEvent[] {
  return [
    createEvent({ type: EventTypes.MESSAGE, projectId: PID, sessionId: SID, sequence: 0, source: 'import', timestamp: '2025-06-01T10:00:00.000Z', payload: { role: MessageRoles.USER, content: 'Set up the monorepo structure' } }),
    createEvent({ type: EventTypes.MESSAGE, projectId: PID, sessionId: SID, sequence: 1, source: 'import', timestamp: '2025-06-01T10:01:00.000Z', payload: { role: MessageRoles.ASSISTANT, content: 'Done, created four packages with pnpm workspaces.' } }),
    createEvent({ type: EventTypes.COMMAND, projectId: PID, sessionId: SID, sequence: 2, source: 'cli', timestamp: '2025-06-01T10:05:00.000Z', payload: { command: 'npm test' } }),
    createEvent({ type: EventTypes.COMMAND_OUTPUT, projectId: PID, sessionId: SID, sequence: 3, source: 'cli', timestamp: '2025-06-01T10:05:30.000Z', payload: { commandEventId: 'e2', stdout: '42 tests passed', exitCode: 0 } }),
    createEvent({ type: EventTypes.TOOL_CALL, projectId: PID, sessionId: SID, sequence: 4, source: 'import', timestamp: '2025-06-01T10:10:00.000Z', payload: { toolName: 'web_search', input: { query: 'pnpm workspace' }, callId: 'call_1' } }),
    createEvent({ type: EventTypes.TOOL_RESULT, projectId: PID, sessionId: SID, sequence: 5, source: 'import', timestamp: '2025-06-01T10:10:05.000Z', payload: { toolName: 'web_search', output: 'Found 3 results', callId: 'call_1' } }),
    createEvent({ type: EventTypes.MESSAGE, projectId: PID, sessionId: SID, sequence: 6, source: 'import', timestamp: '2025-06-01T10:15:00.000Z', payload: { role: MessageRoles.USER, content: 'Now implement the event schema with seven types.' } }),
    createEvent({ type: EventTypes.SYSTEM, projectId: PID, sessionId: SID, sequence: 7, source: 'cli', timestamp: '2025-06-01T10:20:00.000Z', payload: { action: SystemActions.CHECKPOINT, message: 'Before refactor' } }),
    createEvent({ type: EventTypes.MESSAGE, projectId: PID, sessionId: SID, sequence: 8, source: 'import', timestamp: '2025-06-01T10:25:00.000Z', payload: { role: MessageRoles.ASSISTANT, content: 'Implemented all seven event types with hash verification.' } }),
    createEvent({ type: EventTypes.MESSAGE, projectId: PID, sessionId: SID, sequence: 9, source: 'import', timestamp: '2025-06-01T10:30:00.000Z', payload: { role: MessageRoles.USER, content: 'Add the full-text search capability.' } }),
  ];
}

describe('timeline', () => {
  let root: string;
  let db: MetadataDB;
  let events: ContinuumEvent[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-timeline-test-'));
    initWorkspace(root);
    db = openDB(root);
    ensureFTS(db);

    const proj = createProject(root, { title: 'Timeline Test' }).data!;
    syncProject(db, { ...proj, id: PID } as any);

    const sess = startSession(root, { projectId: proj.id }).data!;
    syncSession(db, { ...sess, id: SID, projectId: PID } as any);

    events = makeEvents();
    syncEvents(db, events);
    indexEvents(db, events);
  });

  afterEach(() => {
    closeDB(root);
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Filtering ──────────────────────────────────────

  describe('ST1 — filtering', () => {
    it('should return all events for a project', () => {
      const result = getTimeline(db, { projectId: PID });
      expect(result.total).toBe(10);
      expect(result.entries).toHaveLength(10);
    });

    it('should filter by session ID', () => {
      const result = getTimeline(db, { projectId: PID, sessionId: SID });
      expect(result.total).toBe(10);
    });

    it('should filter by single event type', () => {
      const result = getTimeline(db, { projectId: PID, types: ['command'] });
      expect(result.total).toBe(1);
      expect(result.entries[0].type).toBe('command');
    });

    it('should filter by multiple event types', () => {
      const result = getTimeline(db, { projectId: PID, types: ['message', 'system'] });
      expect(result.total).toBe(6); // 5 messages + 1 system
      for (const e of result.entries) {
        expect(['message', 'system']).toContain(e.type);
      }
    });

    it('should filter by source', () => {
      const result = getTimeline(db, { projectId: PID, source: 'cli' });
      expect(result.total).toBe(3); // command, command_output, system
      for (const e of result.entries) {
        expect(e.source).toBe('cli');
      }
    });

    it('should filter by date range — after', () => {
      const result = getTimeline(db, { projectId: PID, after: '2025-06-01T10:15:00.000Z' });
      expect(result.total).toBe(3);
      for (const e of result.entries) {
        expect(e.timestamp > '2025-06-01T10:15:00.000Z').toBe(true);
      }
    });

    it('should filter by date range — before', () => {
      const result = getTimeline(db, { projectId: PID, before: '2025-06-01T10:05:00.000Z' });
      expect(result.total).toBe(2);
    });

    it('should filter by date range — between', () => {
      const result = getTimeline(db, {
        projectId: PID,
        after: '2025-06-01T10:04:00.000Z',
        before: '2025-06-01T10:16:00.000Z',
      });
      expect(result.total).toBe(5); // seq 2,3,4,5,6
    });

    it('should filter by sequence range', () => {
      const result = getTimeline(db, { projectId: PID, fromSequence: 3, toSequence: 6 });
      expect(result.total).toBe(4);
      expect(result.entries[0].sequence).toBe(3);
      expect(result.entries[3].sequence).toBe(6);
    });

    it('should combine multiple filters', () => {
      const result = getTimeline(db, {
        projectId: PID,
        types: ['message'],
        source: 'import',
        after: '2025-06-01T10:10:00.000Z',
      });
      // Messages from 'import' after 10:10: seq 6, 8, 9
      expect(result.total).toBe(3);
    });

    it('should return empty for non-matching filters', () => {
      const result = getTimeline(db, { projectId: PID, types: ['artifact'] });
      expect(result.total).toBe(0);
      expect(result.entries).toHaveLength(0);
    });

    it('should return empty for non-existent project', () => {
      const result = getTimeline(db, { projectId: 'proj_nope' });
      expect(result.total).toBe(0);
    });
  });

  // ── ST2: Chronological retrieval ────────────────────────

  describe('ST2 — chronological ordering', () => {
    it('should return events in ascending order by default', () => {
      const result = getTimeline(db, { projectId: PID });
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i].sequence).toBeGreaterThan(result.entries[i - 1].sequence);
      }
    });

    it('should return events in descending order with --desc', () => {
      const result = getTimeline(db, { projectId: PID, order: 'desc' });
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i].sequence).toBeLessThan(result.entries[i - 1].sequence);
      }
    });

    it('should support pagination with limit and offset', () => {
      const page1 = getTimeline(db, { projectId: PID, limit: 3, offset: 0 });
      const page2 = getTimeline(db, { projectId: PID, limit: 3, offset: 3 });
      const page3 = getTimeline(db, { projectId: PID, limit: 3, offset: 6 });
      const page4 = getTimeline(db, { projectId: PID, limit: 3, offset: 9 });

      expect(page1.entries).toHaveLength(3);
      expect(page1.hasMore).toBe(true);

      expect(page2.entries).toHaveLength(3);
      expect(page2.hasMore).toBe(true);

      expect(page3.entries).toHaveLength(3);
      expect(page3.hasMore).toBe(true);

      expect(page4.entries).toHaveLength(1);
      expect(page4.hasMore).toBe(false);

      // No overlap
      const allIds = [...page1.entries, ...page2.entries, ...page3.entries, ...page4.entries].map((e) => e.id);
      expect(new Set(allIds).size).toBe(10);
    });

    it('should include total count and hasMore', () => {
      const result = getTimeline(db, { projectId: PID, limit: 5 });
      expect(result.total).toBe(10);
      expect(result.hasMore).toBe(true);
      expect(result.filter.projectId).toBe(PID);
    });

    it('should generate human-readable previews', () => {
      const result = getTimeline(db, { projectId: PID });

      const msgEntry = result.entries.find((e) => e.type === 'message');
      expect(msgEntry!.preview.length).toBeGreaterThan(0);

      const cmdEntry = result.entries.find((e) => e.type === 'command');
      expect(cmdEntry!.preview).toContain('$');

      const sysEntry = result.entries.find((e) => e.type === 'system');
      expect(sysEntry!.preview).toContain('checkpoint');
    });
  });

  // ── ST3: Direct retrieval by ID ─────────────────────────

  describe('ST3 — direct event retrieval', () => {
    it('should retrieve a single event by ID', () => {
      const targetId = events[0].id;
      const entry = getEventById(db, targetId);

      expect(entry).not.toBeNull();
      expect(entry!.id).toBe(targetId);
      expect(entry!.type).toBe('message');
      expect(entry!.sequence).toBe(0);
      expect(entry!.payload).toHaveProperty('content');
    });

    it('should return null for non-existent ID', () => {
      expect(getEventById(db, 'evt_nonexistent')).toBeNull();
    });

    it('should include full payload', () => {
      const entry = getEventById(db, events[4].id);
      expect(entry!.payload).toHaveProperty('toolName', 'web_search');
      expect(entry!.payload).toHaveProperty('input');
      expect(entry!.payload).toHaveProperty('callId', 'call_1');
    });

    it('should retrieve multiple events by IDs', () => {
      const ids = [events[0].id, events[4].id, events[7].id];
      const entries = getEventsByIds(db, ids);

      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe(events[0].id);
      expect(entries[1].id).toBe(events[4].id);
      expect(entries[2].id).toBe(events[7].id);
    });

    it('should return results in sequence order for batch', () => {
      const ids = [events[7].id, events[0].id, events[4].id]; // out of order
      const entries = getEventsByIds(db, ids);

      expect(entries[0].sequence).toBeLessThan(entries[1].sequence);
      expect(entries[1].sequence).toBeLessThan(entries[2].sequence);
    });

    it('should skip missing IDs in batch', () => {
      const ids = [events[0].id, 'evt_missing', events[9].id];
      const entries = getEventsByIds(db, ids);

      expect(entries).toHaveLength(2);
    });

    it('should return empty for empty IDs array', () => {
      expect(getEventsByIds(db, [])).toHaveLength(0);
    });
  });

  // ── Utility functions ───────────────────────────────────

  describe('utility functions', () => {
    it('should return distinct event types', () => {
      const types = getDistinctTypes(db, PID);
      expect(types).toContain('message');
      expect(types).toContain('command');
      expect(types).toContain('tool_call');
      expect(types).toContain('system');
    });

    it('should return distinct sources', () => {
      const sources = getDistinctSources(db, PID);
      expect(sources).toContain('import');
      expect(sources).toContain('cli');
    });

    it('should return time range', () => {
      const range = getTimeRange(db, PID);
      expect(range.earliest).toBe('2025-06-01T10:00:00.000Z');
      expect(range.latest).toBe('2025-06-01T10:30:00.000Z');
    });

    it('should return null range for empty project', () => {
      const range = getTimeRange(db, 'proj_empty');
      expect(range.earliest).toBeNull();
      expect(range.latest).toBeNull();
    });
  });
});
