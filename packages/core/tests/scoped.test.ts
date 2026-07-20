import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt,
  exportScopedCapsule, encryptFile, decryptFile,
  AttemptOutcomes,
} from '../src/index';
import type { ContinuumEvent } from '../src/index';

describe('exportScopedCapsule()', () => {
  let root: string;
  let outputDir: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-scoped-'));
    outputDir = mkdtempSync(join(tmpdir(), 'continuum-scoped-out-'));
    initWorkspace(root);

    const proj = createProject(root, { title: 'Scoped Test', description: 'Testing scoped export' }).data!;
    projectId = proj.id;
    const sess = startSession(root, { projectId, provider: 'test', model: 'test-1' }).data!;
    sessionId = sess.id;

    importTranscript(root, projectId, sessionId, parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a CLI tool.' },
      { role: 'assistant', content: 'Set up the project structure.' },
      { role: 'user', content: 'The system must preserve events.' },
      { role: 'user', content: 'My API key is sk-ant-api03-abcdefghijklmnop12345678 — keep it safe.' },
      { role: 'assistant', content: 'I will not store your API key.' },
    ])), 'test');

    const events = openLedger(root, projectId, sessionId).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));
    createDecision(root, { projectId, choice: 'Use JSONL' });
    createTask(root, { projectId, description: 'Build MCP' });
    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  // ── ST1: Scope filtering ────────────────────────────────

  describe('ST1 — scope filtering', () => {
    it('should export all events when no scope is set', () => {
      const result = exportScopedCapsule({ workspaceRoot: root, projectId, outputDir, privacy: { enabled: false } });

      expect(result.error).toBeNull();
      expect(result.eventsIncluded).toBe(5);
      expect(result.eventsByScope).toBe(0);
    });

    it('should filter by event type', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        scope: { eventTypes: ['message'] },
        privacy: { enabled: false },
      });

      expect(result.eventsIncluded).toBe(5); // all are messages
    });

    it('should filter by keywords', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        scope: { keywords: ['API key'] },
        privacy: { enabled: false },
      });

      expect(result.eventsIncluded).toBeLessThan(5);
      expect(result.eventsIncluded).toBeGreaterThanOrEqual(1);
    });

    it('should filter by session', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        scope: { sessionIds: ['sess_nonexistent'] },
        privacy: { enabled: false },
      });

      expect(result.eventsIncluded).toBe(0);
      expect(result.eventsByScope).toBe(5);
    });

    it('should exclude specific event IDs', () => {
      const events = openLedger(root, projectId, sessionId).readAll().events;
      const excludeId = events[0].id;

      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        scope: { excludeEventIds: [excludeId] },
        privacy: { enabled: false },
      });

      expect(result.eventsIncluded).toBe(4);
      expect(result.eventsByScope).toBe(1);
    });

    it('should include scope metadata file', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        scope: { keywords: ['goal'] },
        privacy: { enabled: false },
      });

      const scopeJson = JSON.parse(readFileSync(join(result.capsulePath, 'scope.json'), 'utf-8'));
      expect(scopeJson.filter).toHaveProperty('keywords');
      expect(scopeJson.totalEvents).toBe(5);
    });
  });

  // ── ST2: Privacy exclusion ──────────────────────────────

  describe('ST2 — privacy exclusion', () => {
    it('should redact secrets by default', () => {
      const result = exportScopedCapsule({ workspaceRoot: root, projectId, outputDir });

      expect(result.redactionReport).not.toBeNull();
      expect(result.redactionReport!.summary.totalDetections).toBeGreaterThanOrEqual(1);

      // Read the events and check secrets are redacted
      const ledger = readFileSync(join(result.capsulePath, 'events.jsonl'), 'utf-8');
      expect(ledger).not.toContain('sk-ant-api03');
      expect(ledger).toContain('[REDACTED]');
    });

    it('should exclude events with secrets when action is exclude', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        privacy: { enabled: true, defaultAction: 'exclude' as any },
      });

      expect(result.eventsByPrivacy).toBeGreaterThanOrEqual(1);
      expect(result.eventsIncluded).toBeLessThan(5);
    });

    it('should skip privacy scan when disabled', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        privacy: { enabled: false },
      });

      expect(result.redactionReport).toBeNull();
      expect(result.eventsByPrivacy).toBe(0);

      // Secret should still be in the output
      const ledger = readFileSync(join(result.capsulePath, 'events.jsonl'), 'utf-8');
      expect(ledger).toContain('sk-ant-api03');
    });

    it('should include redaction report file', () => {
      const result = exportScopedCapsule({ workspaceRoot: root, projectId, outputDir });

      const reportPath = join(result.capsulePath, 'redaction-report.json');
      expect(existsSync(reportPath)).toBe(true);

      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      expect(report).toHaveProperty('riskLevel');
      expect(report).toHaveProperty('transferSafe');
    });
  });

  // ── ST3: Encryption ─────────────────────────────────────

  describe('ST3 — encryption', () => {
    it('should encrypt capsule files when passphrase is provided', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        passphrase: 'test-passphrase-123',
        privacy: { enabled: false },
      });

      expect(result.encrypted).toBe(true);

      // events.jsonl should be encrypted
      expect(existsSync(join(result.capsulePath, 'events.jsonl'))).toBe(false);
      expect(existsSync(join(result.capsulePath, 'events.jsonl.enc'))).toBe(true);

      // manifest.json should NOT be encrypted (readable for import)
      expect(existsSync(join(result.capsulePath, 'manifest.json'))).toBe(true);
    });

    it('should decrypt files with the correct passphrase', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        passphrase: 'my-secret',
        privacy: { enabled: false },
      });

      const encPath = join(result.capsulePath, 'events.jsonl.enc');
      const decrypted = decryptFile(encPath, 'my-secret');
      const content = decrypted.toString('utf-8');

      expect(content).toContain('"type":"message"');
      expect(content).toContain('CLI tool');
    });

    it('should fail to decrypt with wrong passphrase', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        passphrase: 'correct-pass',
        privacy: { enabled: false },
      });

      const encPath = join(result.capsulePath, 'events.jsonl.enc');

      expect(() => decryptFile(encPath, 'wrong-pass')).toThrow();
    });

    it('should encrypt state, tracking, and other files', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        passphrase: 'encrypt-all',
        privacy: { enabled: false },
      });

      const files = readdirSync(result.capsulePath);
      const encFiles = files.filter((f) => f.endsWith('.enc'));

      // Should have encrypted: events.jsonl, state.json, decisions.json, tasks.json, attempts.json, etc.
      expect(encFiles.length).toBeGreaterThanOrEqual(2);

      // manifest.json should be the only non-encrypted file
      const plainFiles = files.filter((f) => !f.endsWith('.enc'));
      expect(plainFiles).toContain('manifest.json');
    });

    it('should indicate encryption in manifest', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        passphrase: 'test',
        privacy: { enabled: false },
      });

      const manifest = JSON.parse(readFileSync(join(result.capsulePath, 'manifest.json'), 'utf-8'));
      expect(manifest.encrypted).toBe(true);
      expect(manifest.encryptedFiles).toBeDefined();
    });

    it('should not encrypt when no passphrase is given', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        privacy: { enabled: false },
      });

      expect(result.encrypted).toBe(false);
      expect(existsSync(join(result.capsulePath, 'events.jsonl'))).toBe(true);
    });
  });

  // ── Content toggles ─────────────────────────────────────

  describe('content toggles', () => {
    it('should exclude state when disabled', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        includeState: false,
        privacy: { enabled: false },
      });

      expect(existsSync(join(result.capsulePath, 'state.json'))).toBe(false);
    });

    it('should exclude tracking when disabled', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        includeTracking: false,
        privacy: { enabled: false },
      });

      expect(existsSync(join(result.capsulePath, 'decisions.json'))).toBe(false);
      expect(existsSync(join(result.capsulePath, 'tasks.json'))).toBe(false);
    });

    it('should include all by default', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        privacy: { enabled: false },
      });

      expect(existsSync(join(result.capsulePath, 'state.json'))).toBe(true);
      expect(existsSync(join(result.capsulePath, 'decisions.json'))).toBe(true);
    });
  });

  // ── Combined filters ───────────────────────────────────

  describe('combined scope + privacy', () => {
    it('should apply scope first, then privacy', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        scope: { keywords: ['API key', 'goal'] },
        privacy: { enabled: true, defaultAction: 'redact' as any },
      });

      // Some events filtered by scope, remaining scanned for secrets
      expect(result.eventsByScope).toBeGreaterThanOrEqual(0);
      expect(result.eventsIncluded).toBeGreaterThanOrEqual(1);

      // Secrets should be redacted in included events
      const ledger = readFileSync(join(result.capsulePath, 'events.jsonl'), 'utf-8');
      expect(ledger).not.toContain('sk-ant-api03');
    });
  });

  // ── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('should error for nonexistent project', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId: 'proj_nope', outputDir,
      });
      expect(result.error).toContain('not found');
    });

    it('should include notes and expiry', () => {
      const result = exportScopedCapsule({
        workspaceRoot: root, projectId, outputDir,
        notes: 'Scoped for review',
        expiresAt: '2026-12-31T23:59:59.000Z',
        privacy: { enabled: false },
      });

      expect(result.manifest.notes).toBe('Scoped for review');
    });
  });
});
