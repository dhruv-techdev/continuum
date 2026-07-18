import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  startSession,
  getSession,
  listSessions,
  closeSession,
  SessionStatuses,
} from '../src/index';

describe('session-store', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-sess-test-'));
    initWorkspace(root);
    const result = createProject(root, { title: 'Session Test Project' });
    projectId = result.data!.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── startSession ────────────────────────────────────────────

  describe('startSession()', () => {
    it('should create a session with generated ID and active status', () => {
      const result = startSession(root, { projectId });
      expect(result.error).toBeNull();

      const s = result.data!;
      expect(s.id).toMatch(/^sess_/);
      expect(s.projectId).toBe(projectId);
      expect(s.status).toBe(SessionStatuses.ACTIVE);
      expect(s.startedAt).toMatch(/Z$/);
      expect(s.closedAt).toBeNull();
      expect(s.eventCount).toBe(0);
    });

    it('should use provided provider and model', () => {
      const result = startSession(root, {
        projectId,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      });
      expect(result.data!.provider).toBe('anthropic');
      expect(result.data!.model).toBe('claude-sonnet-4-6');
    });

    it('should default provider and model to "unknown"', () => {
      const result = startSession(root, { projectId });
      expect(result.data!.provider).toBe('unknown');
      expect(result.data!.model).toBe('unknown');
    });

    it('should error for nonexistent project', () => {
      const result = startSession(root, { projectId: 'proj_nonexistent' });
      expect(result.data).toBeNull();
      expect(result.error).toContain('not found');
    });

    it('should allow multiple concurrent sessions', () => {
      const r1 = startSession(root, { projectId });
      const r2 = startSession(root, { projectId });
      expect(r1.data!.id).not.toBe(r2.data!.id);
      expect(r1.data!.status).toBe('active');
      expect(r2.data!.status).toBe('active');
    });
  });

  // ── getSession ──────────────────────────────────────────────

  describe('getSession()', () => {
    it('should retrieve a started session', () => {
      const started = startSession(root, { projectId }).data!;
      const found = getSession(root, projectId, started.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(started.id);
      expect(found!.projectId).toBe(projectId);
    });

    it('should return null for nonexistent session', () => {
      expect(getSession(root, projectId, 'sess_nonexistent')).toBeNull();
    });
  });

  // ── listSessions ────────────────────────────────────────────

  describe('listSessions()', () => {
    it('should return empty array when no sessions exist', () => {
      expect(listSessions(root, projectId)).toEqual([]);
    });

    it('should return all sessions with active first', () => {
      const s1 = startSession(root, { projectId }).data!;
      const s2 = startSession(root, { projectId }).data!;
      closeSession(root, projectId, s1.id);

      const list = listSessions(root, projectId);
      expect(list).toHaveLength(2);
      // Active session (s2) should come first
      expect(list[0].status).toBe('active');
      expect(list[0].id).toBe(s2.id);
      expect(list[1].status).toBe('closed');
    });
  });

  // ── closeSession ────────────────────────────────────────────

  describe('closeSession()', () => {
    it('should set status to closed and add closedAt', () => {
      const s = startSession(root, { projectId }).data!;
      const result = closeSession(root, projectId, s.id);

      expect(result.error).toBeNull();
      expect(result.data!.status).toBe(SessionStatuses.CLOSED);
      expect(result.data!.closedAt).toMatch(/Z$/);
    });

    it('should persist the closed state on disk', () => {
      const s = startSession(root, { projectId }).data!;
      closeSession(root, projectId, s.id);

      const reloaded = getSession(root, projectId, s.id);
      expect(reloaded!.status).toBe('closed');
      expect(reloaded!.closedAt).not.toBeNull();
    });

    it('should error when closing an already-closed session', () => {
      const s = startSession(root, { projectId }).data!;
      closeSession(root, projectId, s.id);

      const result = closeSession(root, projectId, s.id);
      expect(result.data).toBeNull();
      expect(result.error).toContain('already closed');
    });

    it('should error for nonexistent session', () => {
      const result = closeSession(root, projectId, 'sess_nonexistent');
      expect(result.data).toBeNull();
      expect(result.error).toContain('not found');
    });
  });
});
