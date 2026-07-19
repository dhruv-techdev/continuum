import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt,
  registerArtifact,
  buildManifest, validateManifest, isCompatibleCapsuleVersion,
  CAPSULE_SCHEMA_VERSION, AttemptOutcomes,
} from '../src/index';
import type { CapsuleManifest } from '../src/index';

describe('capsule manifest', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-capsule-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Capsule Test', description: 'Testing capsules' }).data!;
    projectId = proj.id;
    const sess = startSession(root, { projectId, provider: 'test', model: 'test-1' }).data!;
    sessionId = sess.id;

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a CLI tool.' },
      { role: 'assistant', content: 'I have set up the project structure.' },
      { role: 'user', content: 'The system must preserve events.' },
    ]));
    importTranscript(root, projectId, sessionId, parseResult, 'test');

    // Extract state
    const events = openLedger(root, projectId, sessionId).readAll().events;
    const state = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, state);

    // Add tracking data
    createDecision(root, { projectId, choice: 'Use JSONL', rationale: 'Simplicity' });
    createTask(root, { projectId, description: 'Implement schema' });
    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM issues' });

    // Register an artifact
    const testFile = join(root, 'main.ts');
    writeFileSync(testFile, 'console.log("hello");', 'utf-8');
    registerArtifact(root, { projectId, uri: testFile });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Manifest structure ─────────────────────────────

  describe('ST1 — manifest metadata', () => {
    it('should include schema version', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.schemaVersion).toBe(CAPSULE_SCHEMA_VERSION);
    });

    it('should generate a unique capsule ID', () => {
      const m1 = buildManifest({ workspaceRoot: root, projectId });
      const m2 = buildManifest({ workspaceRoot: root, projectId });
      expect(m1.capsuleId).toMatch(/^cap_/);
      expect(m1.capsuleId).not.toBe(m2.capsuleId);
    });

    it('should include creation timestamp and tool', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.createdAt).toMatch(/Z$/);
      expect(m.createdBy).toContain('continuum@');
    });

    it('should include project metadata', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.project.id).toBe(projectId);
      expect(m.project.title).toBe('Capsule Test');
      expect(m.project.description).toBe('Testing capsules');
      expect(m.project.sessionCount).toBeGreaterThanOrEqual(1);
      expect(m.project.sessionIds).toContain(sessionId);
    });

    it('should include optional notes and expiry', () => {
      const m = buildManifest({
        workspaceRoot: root,
        projectId,
        notes: 'Pre-release capsule',
        expiresAt: '2025-12-31T23:59:59.000Z',
      });
      expect(m.notes).toBe('Pre-release capsule');
      expect(m.expiresAt).toBe('2025-12-31T23:59:59.000Z');
    });

    it('should support session filtering', () => {
      const m = buildManifest({
        workspaceRoot: root,
        projectId,
        sessionFilter: [sessionId],
      });
      expect(m.sessionFilter).toContain(sessionId);
      expect(m.project.sessionIds).toContain(sessionId);
    });
  });

  // ── ST2: Sections ───────────────────────────────────────

  describe('ST2 — capsule sections', () => {
    it('should include ledger section with event metadata', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.ledger.path).toBe('events.jsonl');
      expect(m.ledger.eventCount).toBe(3);
      expect(m.ledger.eventTypes).toContain('message');
      expect(m.ledger.fileHash).toMatch(/^[0-9a-f]{64}$/);
      expect(m.ledger.fileSize).toBeGreaterThan(0);
      expect(m.ledger.firstTimestamp).not.toBeNull();
      expect(m.ledger.lastTimestamp).not.toBeNull();
    });

    it('should include state section', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.state).not.toBeNull();
      expect(m.state!.path).toBe('state.json');
      expect(m.state!.activeStatements).toBeGreaterThanOrEqual(1);
      expect(m.state!.fileHash).toMatch(/^[0-9a-f]{64}$/);
      expect(m.state!.categoryCounts).toHaveProperty('objectives');
    });

    it('should include tracking section with decisions, tasks, and attempts', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.tracking).not.toBeNull();
      expect(m.tracking!.decisions).not.toBeNull();
      expect(m.tracking!.decisions!.count).toBe(1);
      expect(m.tracking!.tasks).not.toBeNull();
      expect(m.tracking!.tasks!.count).toBe(1);
      expect(m.tracking!.attempts).not.toBeNull();
      expect(m.tracking!.attempts!.count).toBe(1);
    });

    it('should include artifact section', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.artifacts).not.toBeNull();
      expect(m.artifacts!.totalArtifacts).toBe(1);
      expect(m.artifacts!.registryHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should include integrity section with file hashes', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.integrity.algorithm).toBe('sha256');
      expect(m.integrity.files.length).toBeGreaterThanOrEqual(1);
      expect(m.integrity.computedAt).toMatch(/Z$/);

      for (const f of m.integrity.files) {
        expect(f.path.length).toBeGreaterThan(0);
        expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(f.size).toBeGreaterThan(0);
      }
    });

    it('should set evaluations to null (not yet implemented)', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      expect(m.evaluations).toBeNull();
    });
  });

  // ── ST3: Validation ─────────────────────────────────────

  describe('ST3 — validation', () => {
    it('should validate a correctly built manifest', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      const errors = validateManifest(m);
      expect(errors).toEqual([]);
    });

    it('should reject non-object input', () => {
      expect(validateManifest(null)).toHaveLength(1);
      expect(validateManifest('string')).toHaveLength(1);
      expect(validateManifest(42)).toHaveLength(1);
    });

    it('should catch missing required fields', () => {
      const errors = validateManifest({});
      expect(errors.some((e) => e.field === 'schemaVersion')).toBe(true);
      expect(errors.some((e) => e.field === 'capsuleId')).toBe(true);
      expect(errors.some((e) => e.field === 'project')).toBe(true);
      expect(errors.some((e) => e.field === 'ledger')).toBe(true);
      expect(errors.some((e) => e.field === 'integrity')).toBe(true);
    });

    it('should catch incompatible schema version', () => {
      const m = buildManifest({ workspaceRoot: root, projectId }) as Record<string, unknown>;
      m.schemaVersion = '99.0.0';
      const errors = validateManifest(m);
      expect(errors.some((e) => e.field === 'schemaVersion')).toBe(true);
    });

    it('should catch missing project fields', () => {
      const m = buildManifest({ workspaceRoot: root, projectId }) as Record<string, unknown>;
      m.project = { id: 'p1' }; // missing title, createdAt, sessionIds, sessionCount
      const errors = validateManifest(m);
      expect(errors.some((e) => e.field === 'project.title')).toBe(true);
      expect(errors.some((e) => e.field === 'project.sessionIds')).toBe(true);
    });

    it('should catch missing ledger fields', () => {
      const m = buildManifest({ workspaceRoot: root, projectId }) as Record<string, unknown>;
      m.ledger = { path: 'events.jsonl' }; // missing eventCount, eventTypes, fileHash, fileSize
      const errors = validateManifest(m);
      expect(errors.some((e) => e.field === 'ledger.eventCount')).toBe(true);
      expect(errors.some((e) => e.field === 'ledger.fileHash')).toBe(true);
    });

    it('should catch bad integrity file entries', () => {
      const m = buildManifest({ workspaceRoot: root, projectId }) as Record<string, unknown>;
      (m as any).integrity = { algorithm: 'sha256', files: [{ path: '', hash: '', size: 'bad' }], computedAt: new Date().toISOString() };
      const errors = validateManifest(m);
      expect(errors.some((e) => e.field.includes('integrity.files'))).toBe(true);
    });

    it('should accept null for optional sections', () => {
      const m = buildManifest({ workspaceRoot: root, projectId });
      m.state = null;
      m.tracking = null;
      m.artifacts = null;
      m.evaluations = null;
      const errors = validateManifest(m);
      expect(errors).toEqual([]);
    });

    it('should validate optional sections when present', () => {
      const m = buildManifest({ workspaceRoot: root, projectId }) as Record<string, unknown>;
      m.state = { path: '' }; // missing required fields within state
      const errors = validateManifest(m);
      expect(errors.some((e) => e.field === 'state.path')).toBe(true);
    });
  });

  // ── Schema version compatibility ────────────────────────

  describe('isCompatibleCapsuleVersion()', () => {
    it('should accept current version', () => {
      expect(isCompatibleCapsuleVersion(CAPSULE_SCHEMA_VERSION)).toBe(true);
    });

    it('should accept same major, different minor', () => {
      const major = CAPSULE_SCHEMA_VERSION.split('.')[0];
      expect(isCompatibleCapsuleVersion(`${major}.99.99`)).toBe(true);
    });

    it('should reject different major', () => {
      expect(isCompatibleCapsuleVersion('99.0.0')).toBe(false);
    });

    it('should reject non-semver', () => {
      expect(isCompatibleCapsuleVersion('bad')).toBe(false);
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle project with no events', () => {
      const emptyProj = createProject(root, { title: 'Empty' }).data!;
      startSession(root, { projectId: emptyProj.id });

      const m = buildManifest({ workspaceRoot: root, projectId: emptyProj.id });

      expect(m.ledger.eventCount).toBe(0);
      expect(m.state).toBeNull();
      expect(m.tracking).toBeNull();
      expect(validateManifest(m)).toEqual([]);
    });

    it('should handle project with only events, no state or tracking', () => {
      const proj2 = createProject(root, { title: 'Events Only' }).data!;
      const sess2 = startSession(root, { projectId: proj2.id }).data!;
      importTranscript(root, proj2.id, sess2.id, parseJSON(JSON.stringify([
        { role: 'user', content: 'hi' },
      ])), 'test');

      const m = buildManifest({ workspaceRoot: root, projectId: proj2.id });

      expect(m.ledger.eventCount).toBe(1);
      expect(m.state).toBeNull();
      expect(m.tracking).toBeNull();
      expect(m.artifacts).toBeNull();
      expect(validateManifest(m)).toEqual([]);
    });
  });
});
