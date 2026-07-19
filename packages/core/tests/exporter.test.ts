import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt,
  registerArtifact, StorageModes,
  exportCapsule, verifyCapsuleIntegrity, validateManifest,
  AttemptOutcomes,
} from '../src/index';

describe('exportCapsule()', () => {
  let root: string;
  let outputDir: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-export-'));
    outputDir = mkdtempSync(join(tmpdir(), 'continuum-capsule-out-'));
    initWorkspace(root);

    const proj = createProject(root, { title: 'Export Test', description: 'Testing export' }).data!;
    projectId = proj.id;
    const sess = startSession(root, { projectId, provider: 'test', model: 'test-1' }).data!;
    sessionId = sess.id;

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a CLI tool.' },
      { role: 'assistant', content: 'Set up the project structure.' },
      { role: 'user', content: 'The system must preserve events.' },
    ]));
    importTranscript(root, projectId, sessionId, parseResult, 'test');

    // State
    const events = openLedger(root, projectId, sessionId).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));

    // Tracking
    createDecision(root, { projectId, choice: 'Use JSONL' });
    createTask(root, { projectId, description: 'Build schema' });
    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM' });

    // Artifact
    const testFile = join(root, 'main.ts');
    writeFileSync(testFile, 'export default 1;', 'utf-8');
    registerArtifact(root, { projectId, uri: testFile, storageMode: StorageModes.CONTENT });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  // ── ST1: Package contents ───────────────────────────────

  describe('ST1 — packaging', () => {
    it('should create a .ctx directory with all components', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      expect(result.error).toBeNull();
      expect(existsSync(result.capsulePath)).toBe(true);

      // Check files exist
      expect(existsSync(join(result.capsulePath, 'manifest.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'events.jsonl'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'state.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'decisions.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'tasks.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'attempts.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'artifacts.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'integrity.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'project.json'))).toBe(true);
    });

    it('should combine events from all sessions into one ledger', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      const ledger = readFileSync(join(result.capsulePath, 'events.jsonl'), 'utf-8');
      const lines = ledger.split('\n').filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(3);

      for (const line of lines) {
        const event = JSON.parse(line);
        expect(event.type).toBe('message');
        expect(event.id).toMatch(/^evt_/);
      }
    });

    it('should include stored artifact content when requested', () => {
      const result = exportCapsule({
        workspaceRoot: root, projectId, outputDir,
        includeArtifactContent: true,
      });

      const artDir = join(result.capsulePath, 'artifacts');
      expect(existsSync(artDir)).toBe(true);
      const files = readdirSync(artDir);
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT include artifact content by default', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      const artDir = join(result.capsulePath, 'artifacts');
      expect(existsSync(artDir)).toBe(false);
    });

    it('should include session manifests', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      const sessDir = join(result.capsulePath, 'sessions');
      expect(existsSync(sessDir)).toBe(true);
      const files = readdirSync(sessDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(sessionId);
    });

    it('should copy project.json', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });
      const proj = JSON.parse(readFileSync(join(result.capsulePath, 'project.json'), 'utf-8'));
      expect(proj.title).toBe('Export Test');
    });

    it('should report files copied and total size', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });
      expect(result.filesCopied).toBeGreaterThanOrEqual(8);
      expect(result.totalSize).toBeGreaterThan(0);
    });

    it('should support session filtering', () => {
      // Create a second session
      const sess2 = startSession(root, { projectId }).data!;
      importTranscript(root, projectId, sess2.id,
        parseJSON(JSON.stringify([{ role: 'user', content: 'Second session' }])), 'test');

      // Export only first session
      const result = exportCapsule({
        workspaceRoot: root, projectId, outputDir,
        sessionFilter: [sessionId],
      });

      const ledger = readFileSync(join(result.capsulePath, 'events.jsonl'), 'utf-8');
      const lines = ledger.split('\n').filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(3); // Only first session's events
    });

    it('should include notes and expiry in manifest', () => {
      const result = exportCapsule({
        workspaceRoot: root, projectId, outputDir,
        notes: 'Test capsule',
        expiresAt: '2026-01-01T00:00:00.000Z',
      });

      expect(result.manifest.notes).toBe('Test capsule');
      expect(result.manifest.expiresAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  // ── ST2: Integrity manifest ─────────────────────────────

  describe('ST2 — integrity manifest', () => {
    it('should write integrity.json with SHA-256 hashes', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      const integrity = JSON.parse(readFileSync(join(result.capsulePath, 'integrity.json'), 'utf-8'));

      expect(integrity.algorithm).toBe('sha256');
      expect(integrity.files.length).toBeGreaterThanOrEqual(1);
      expect(integrity.computedAt).toMatch(/Z$/);

      for (const f of integrity.files) {
        expect(f.path.length).toBeGreaterThan(0);
        expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(f.size).toBeGreaterThan(0);
      }
    });

    it('should include events.jsonl in integrity', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      const integrity = JSON.parse(readFileSync(join(result.capsulePath, 'integrity.json'), 'utf-8'));
      const ledgerEntry = integrity.files.find((f: { path: string }) => f.path === 'events.jsonl');

      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce a valid manifest', () => {
      const result = exportCapsule({ workspaceRoot: root, projectId, outputDir });
      const errors = validateManifest(result.manifest);
      expect(errors).toEqual([]);
    });
  });

  // ── Verification ────────────────────────────────────────

  describe('verifyCapsuleIntegrity()', () => {
    it('should verify an untampered capsule', () => {
      const exported = exportCapsule({ workspaceRoot: root, projectId, outputDir });
      const result = verifyCapsuleIntegrity(exported.capsulePath);

      expect(result.valid).toBe(true);
      expect(result.filesChecked).toBeGreaterThanOrEqual(1);
      expect(result.mismatches).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
    });

    it('should detect tampered files', () => {
      const exported = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      // Tamper with events.jsonl
      const ledgerPath = join(exported.capsulePath, 'events.jsonl');
      writeFileSync(ledgerPath, 'TAMPERED DATA', 'utf-8');

      const result = verifyCapsuleIntegrity(exported.capsulePath);

      expect(result.valid).toBe(false);
      expect(result.mismatches.length).toBeGreaterThanOrEqual(1);
      expect(result.mismatches[0].path).toBe('events.jsonl');
    });

    it('should detect missing files', () => {
      const exported = exportCapsule({ workspaceRoot: root, projectId, outputDir });

      // Delete events.jsonl
      const { unlinkSync } = require('fs');
      unlinkSync(join(exported.capsulePath, 'events.jsonl'));

      const result = verifyCapsuleIntegrity(exported.capsulePath);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('events.jsonl');
    });

    it('should error for nonexistent capsule', () => {
      const result = verifyCapsuleIntegrity('/nonexistent/capsule');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('should error for nonexistent project', () => {
      const result = exportCapsule({
        workspaceRoot: root,
        projectId: 'proj_nonexistent',
        outputDir,
      });
      expect(result.error).toContain('not found');
    });

    it('should handle project with no events', () => {
      const emptyProj = createProject(root, { title: 'Empty' }).data!;
      startSession(root, { projectId: emptyProj.id });

      const result = exportCapsule({
        workspaceRoot: root,
        projectId: emptyProj.id,
        outputDir,
      });

      expect(result.error).toBeNull();
      expect(result.manifest.ledger.eventCount).toBe(0);
    });
  });
});
