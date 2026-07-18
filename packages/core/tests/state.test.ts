import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getState,
  setState,
  setActiveProject,
  setActiveSession,
} from '../src/state';

describe('workspace state', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-state-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getState()', () => {
    it('should return nulls when state.json does not exist', () => {
      const state = getState(root);
      expect(state.activeProjectId).toBeNull();
      expect(state.activeSessionId).toBeNull();
    });

    it('should return nulls for corrupted state.json', () => {
      writeFileSync(join(root, 'state.json'), '{ broken json!!', 'utf-8');
      const state = getState(root);
      expect(state.activeProjectId).toBeNull();
      expect(state.activeSessionId).toBeNull();
    });

    it('should coerce non-string fields to null', () => {
      writeFileSync(
        join(root, 'state.json'),
        JSON.stringify({ activeProjectId: 123, activeSessionId: true }),
        'utf-8',
      );
      const state = getState(root);
      expect(state.activeProjectId).toBeNull();
      expect(state.activeSessionId).toBeNull();
    });
  });

  describe('setState()', () => {
    it('should persist and reload state', () => {
      setState(root, { activeProjectId: 'proj_abc', activeSessionId: 'sess_def' });
      const state = getState(root);
      expect(state.activeProjectId).toBe('proj_abc');
      expect(state.activeSessionId).toBe('sess_def');
    });
  });

  describe('setActiveProject()', () => {
    it('should set active project and clear active session', () => {
      setState(root, { activeProjectId: 'proj_old', activeSessionId: 'sess_old' });
      setActiveProject(root, 'proj_new');

      const state = getState(root);
      expect(state.activeProjectId).toBe('proj_new');
      expect(state.activeSessionId).toBeNull();
    });

    it('should allow clearing the active project', () => {
      setActiveProject(root, 'proj_abc');
      setActiveProject(root, null);

      const state = getState(root);
      expect(state.activeProjectId).toBeNull();
    });
  });

  describe('setActiveSession()', () => {
    it('should set active session without changing project', () => {
      setState(root, { activeProjectId: 'proj_abc', activeSessionId: null });
      setActiveSession(root, 'sess_new');

      const state = getState(root);
      expect(state.activeProjectId).toBe('proj_abc');
      expect(state.activeSessionId).toBe('sess_new');
    });

    it('should allow clearing the active session', () => {
      setActiveSession(root, 'sess_abc');
      setActiveSession(root, null);

      const state = getState(root);
      expect(state.activeSessionId).toBeNull();
    });
  });
});
