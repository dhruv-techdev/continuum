import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt,
  exportCapsule, importCapsule, ImportPhases,
  getProject, listSessions, listProjects,
  AttemptOutcomes, CAPSULE_SCHEMA_VERSION,
} from '../src/index';

describe('importCapsule()', () => {
  let root: string;
  let outputDir: string;
  let importRoot: string;
  let capsulePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-import-src-'));
    outputDir = mkdtempSync(join(tmpdir(), 'continuum-capsule-'));
    importRoot = mkdtempSync(join(tmpdir(), 'continuum-import-dest-'));

    // Create source project
    initWorkspace(root);
    const proj = createProject(root, { title: 'Source Project', description: 'For export' }).data!;
    const sess = startSession(root, { projectId: proj.id, provider: 'anthropic', model: 'claude-sonnet' }).data!;

    importTranscript(root, proj.id, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a context transfer platform.' },
      { role: 'assistant', content: 'Set up the monorepo with pnpm workspaces.' },
      { role: 'user', content: 'The system must preserve all events without modification.' },
      { role: 'user', content: 'I decided to use JSONL for the ledger format.' },
    ])), 'test');

    const events = openLedger(root, proj.id, sess.id).readAll().events;
    saveWorkingState(root, proj.id, extractWorkingState(proj.id, events));
    createDecision(root, { projectId: proj.id, choice: 'Use JSONL' });
    createTask(root, { projectId: proj.id, description: 'Build MCP server' });
    recordAttempt(root, { projectId: proj.id, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM' });

    // Export capsule
    const exported = exportCapsule({ workspaceRoot: root, projectId: proj.id, outputDir });
    capsulePath = exported.capsulePath;

    // Init destination workspace
    initWorkspace(importRoot);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(importRoot, { recursive: true, force: true });
  });

  // ── ST1: Structure validation ───────────────────────────

  describe('ST1 — structure and schema validation', () => {
    it('should import a valid capsule successfully', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });

      expect(result.success).toBe(true);
      expect(result.projectId).toMatch(/^proj_/);
      expect(result.capsuleId).toMatch(/^cap_/);
      expect(result.projectTitle).toBe('Source Project');
      expect(result.eventsImported).toBe(4);
      expect(result.sessionsImported).toBe(1);
      expect(result.phasesCompleted).toContain(ImportPhases.STRUCTURE);
      expect(result.phasesCompleted).toContain(ImportPhases.SCHEMA);
      expect(result.phasesCompleted).toContain(ImportPhases.INTEGRITY);
      expect(result.phasesCompleted).toContain(ImportPhases.EVENTS);
      expect(result.phasesCompleted).toContain(ImportPhases.IMPORT);
    });

    it('should reject nonexistent capsule path', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath: '/nonexistent/path.ctx' });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.phase === 'structure' && i.severity === 'error')).toBe(true);
    });

    it('should reject a file instead of a directory', () => {
      const filePath = join(outputDir, 'not-a-dir.ctx');
      writeFileSync(filePath, 'not a capsule', 'utf-8');

      const result = importCapsule({ workspaceRoot: importRoot, capsulePath: filePath });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.message.includes('directory'))).toBe(true);
    });

    it('should reject capsule without manifest.json', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'empty-capsule-'));
      writeFileSync(join(emptyDir, 'events.jsonl'), '', 'utf-8');

      const result = importCapsule({ workspaceRoot: importRoot, capsulePath: emptyDir });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.message.includes('manifest.json'))).toBe(true);

      rmSync(emptyDir, { recursive: true, force: true });
    });

    it('should reject capsule with incompatible schema version', () => {
      // Tamper with manifest
      const manifestPath = join(capsulePath, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      manifest.schemaVersion = '99.0.0';
      writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');

      const result = importCapsule({ workspaceRoot: importRoot, capsulePath, skipIntegrity: true });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.message.includes('Incompatible'))).toBe(true);
    });

    it('should reject capsule with invalid manifest JSON', () => {
      writeFileSync(join(capsulePath, 'manifest.json'), '{ broken!!!', 'utf-8');

      const result = importCapsule({ workspaceRoot: importRoot, capsulePath, skipIntegrity: true });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.message.includes('not valid JSON'))).toBe(true);
    });

    it('should allow title override', () => {
      const result = importCapsule({
        workspaceRoot: importRoot, capsulePath,
        title: 'Custom Title',
      });

      expect(result.success).toBe(true);
      expect(result.projectTitle).toBe('Custom Title');

      const project = getProject(importRoot, result.projectId!);
      expect(project!.title).toBe('Custom Title');
    });
  });

  // ── ST2: Integrity and event hash verification ──────────

  describe('ST2 — integrity verification', () => {
    it('should reject capsule with tampered events.jsonl', () => {
      writeFileSync(join(capsulePath, 'events.jsonl'), 'TAMPERED DATA\n', 'utf-8');

      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.phase === 'integrity')).toBe(true);
    });

    it('should reject capsule with tampered event hash', () => {
      // Tamper with an event's content but not its hash
      const eventsPath = join(capsulePath, 'events.jsonl');
      let raw = readFileSync(eventsPath, 'utf-8');
      raw = raw.replace('context transfer platform', 'HACKED CONTENT');
      writeFileSync(eventsPath, raw, 'utf-8');

      const result = importCapsule({ workspaceRoot: importRoot, capsulePath, skipIntegrity: true });

      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.phase === 'events' && i.message.includes('hash'))).toBe(true);
    });

    it('should allow skipping integrity check', () => {
      // Tamper with integrity but skip check
      writeFileSync(join(capsulePath, 'integrity.json'), '{}', 'utf-8');

      const result = importCapsule({
        workspaceRoot: importRoot, capsulePath,
        skipIntegrity: true,
      });

      expect(result.success).toBe(true);
    });

    it('should allow skipping event hash checks', () => {
      const result = importCapsule({
        workspaceRoot: importRoot, capsulePath,
        skipEventHashes: true,
      });

      expect(result.success).toBe(true);
      expect(result.eventsImported).toBe(4);
    });
  });

  // ── ST3: Imported project contents ──────────────────────

  describe('ST3 — imported project contents', () => {
    it('should create a new project with correct metadata', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const project = getProject(importRoot, result.projectId!);

      expect(project).not.toBeNull();
      expect(project!.title).toBe('Source Project');
    });

    it('should import sessions with events', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const sessions = listSessions(importRoot, result.projectId!);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].eventCount).toBe(4);
    });

    it('should preserve event content and order', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const sessions = listSessions(importRoot, result.projectId!);
      const ledger = openLedger(importRoot, result.projectId!, sessions[0].id);
      const { events } = ledger.readAll();

      expect(events).toHaveLength(4);
      expect(events[0].sequence).toBeLessThan(events[1].sequence);
      expect((events[0] as any).payload.content).toContain('context transfer');
    });

    it('should preserve session provider and model metadata', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const sessions = listSessions(importRoot, result.projectId!);

      expect(sessions[0].provider).toBe('anthropic');
      expect(sessions[0].model).toBe('claude-sonnet');
    });

    it('should import working state', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const statePath = join(importRoot, 'projects', result.projectId!, 'working-state.json');

      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(state.objectives.length).toBeGreaterThanOrEqual(1);
    });

    it('should import tracking data', () => {
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const projDir = join(importRoot, 'projects', result.projectId!);

      expect(existsSync(join(projDir, 'decisions.json'))).toBe(true);
      expect(existsSync(join(projDir, 'tasks.json'))).toBe(true);
      expect(existsSync(join(projDir, 'attempts.json'))).toBe(true);

      const decisions = JSON.parse(readFileSync(join(projDir, 'decisions.json'), 'utf-8'));
      expect(decisions).toHaveLength(1);
    });

    it('should not collide with existing projects', () => {
      const r1 = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const r2 = importCapsule({ workspaceRoot: importRoot, capsulePath });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.projectId).not.toBe(r2.projectId);

      const projects = listProjects(importRoot);
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Round-trip ──────────────────────────────────────────

  describe('round-trip: export → import → verify', () => {
    it('should preserve all events through a round trip', () => {
      // Import
      const result = importCapsule({ workspaceRoot: importRoot, capsulePath });
      expect(result.success).toBe(true);

      // Read imported events
      const sessions = listSessions(importRoot, result.projectId!);
      const ledger = openLedger(importRoot, result.projectId!, sessions[0].id);
      const { events } = ledger.readAll();

      // Compare with source
      const srcProjects = listProjects(root);
      const srcSessions = listSessions(root, srcProjects[0].id);
      const srcLedger = openLedger(root, srcProjects[0].id, srcSessions[0].id);
      const { events: srcEvents } = srcLedger.readAll();

      expect(events.length).toBe(srcEvents.length);

      for (let i = 0; i < events.length; i++) {
        expect(events[i].id).toBe(srcEvents[i].id);
        expect(events[i].hash).toBe(srcEvents[i].hash);
        expect((events[i] as any).payload.content).toBe((srcEvents[i] as any).payload.content);
      }
    });

    it('should allow re-export of imported project', () => {
      const imported = importCapsule({ workspaceRoot: importRoot, capsulePath });
      const reExportDir = mkdtempSync(join(tmpdir(), 'continuum-reexport-'));

      const reExported = exportCapsule({
        workspaceRoot: importRoot,
        projectId: imported.projectId!,
        outputDir: reExportDir,
      });

      expect(reExported.error).toBeNull();
      expect(reExported.manifest.ledger.eventCount).toBe(4);

      rmSync(reExportDir, { recursive: true, force: true });
    });
  });
});
