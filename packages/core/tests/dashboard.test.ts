import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, updateTaskStatus, recordAttempt,
  registerArtifact,
  generateChecks, scoreChecks, buildReport, saveReport,
  loadDecisions, listTasks, listAttempts,
  buildDashboard,
  TaskStatuses, AttemptOutcomes,
} from '../src/index';
import { writeFileSync } from 'fs';

describe('buildDashboard()', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-dashboard-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Dashboard Test', description: 'Testing the dashboard' }).data!;
    projectId = proj.id;

    const sess = startSession(root, { projectId, provider: 'anthropic', model: 'claude-sonnet' }).data!;

    importTranscript(root, projectId, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a context continuity platform.' },
      { role: 'assistant', content: 'Set up TypeScript monorepo with pnpm workspaces.' },
      { role: 'user', content: 'The system must preserve all events without modification.' },
      { role: 'user', content: 'I decided to use JSONL for the ledger.' },
      { role: 'user', content: 'I tried SQLite but it failed with ARM linking errors.' },
      { role: 'user', content: 'Next step is the MCP server.' },
      { role: 'user', content: 'Should we support real-time streaming?' },
    ])), 'test');

    const events = openLedger(root, projectId, sess.id).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));

    createDecision(root, { projectId, choice: 'Use JSONL', rationale: 'Portable', alternatives: ['SQLite'] });
    const t1 = createTask(root, { projectId, description: 'Implement schema' });
    updateTaskStatus(root, projectId, t1.id, TaskStatuses.COMPLETED, 'Done');
    createTask(root, { projectId, description: 'Build MCP server' });
    const t3 = createTask(root, { projectId, description: 'Deploy to production' });
    updateTaskStatus(root, projectId, t3.id, TaskStatuses.BLOCKED, 'Security review pending');

    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM linking' });
    recordAttempt(root, { projectId, approach: 'JSONL', outcome: AttemptOutcomes.SUCCESS });

    const testFile = join(root, 'test.ts');
    writeFileSync(testFile, 'export default 1;', 'utf-8');
    registerArtifact(root, { projectId, uri: testFile });

    // Verification
    const state = extractWorkingState(projectId, events);
    const checks = generateChecks({
      state,
      decisions: loadDecisions(root, projectId),
      tasks: listTasks(root, projectId),
      attempts: listAttempts(root, projectId),
    });
    const answers = new Map<string, string>();
    for (const c of checks) answers.set(c.id, c.expectedAnswer);
    scoreChecks(checks, answers);
    const report = buildReport(projectId, checks);
    saveReport(root, projectId, report);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Project overview ───────────────────────────────

  describe('ST1 — project overview', () => {
    it('should include project metadata', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.project.title).toBe('Dashboard Test');
      expect(d.project.description).toBe('Testing the dashboard');
      expect(d.project.id).toBe(projectId);
    });

    it('should count sessions', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.sessions.total).toBe(1);
      expect(d.sessions.list).toHaveLength(1);
      expect(d.sessions.list[0].provider).toBe('anthropic');
    });

    it('should count events by type', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.events.total).toBe(7);
      expect(d.events.byType.message).toBe(7);
      expect(d.events.firstTimestamp).not.toBeNull();
      expect(d.events.lastTimestamp).not.toBeNull();
    });

    it('should return null for nonexistent project', () => {
      expect(buildDashboard(root, 'proj_nope')).toBeNull();
    });
  });

  // ── ST2: Working state ──────────────────────────────────

  describe('ST2 — objectives, tasks, blockers, decisions', () => {
    it('should include objectives', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.state.available).toBe(true);
      expect(d.state.objectives.length).toBeGreaterThanOrEqual(1);
      expect(d.state.totalStatements).toBeGreaterThan(0);
    });

    it('should include next actions', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.state.nextActions.length).toBeGreaterThanOrEqual(1);
    });

    it('should include open questions', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.state.openQuestions.length).toBeGreaterThanOrEqual(1);
    });

    it('should include task breakdown', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.tasks.total).toBe(3);
      expect(d.tasks.completed).toBe(1);
      expect(d.tasks.pending).toBe(1);
      expect(d.tasks.blocked).toBe(1);
    });

    it('should include blocked task details', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.tasks.blockedItems).toHaveLength(1);
      expect(d.tasks.blockedItems[0].reason).toContain('Security review');
    });

    it('should include active decisions', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.decisions.active).toBe(1);
      expect(d.decisions.recentDecisions[0].choice).toBe('Use JSONL');
    });

    it('should include attempt summary', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.attempts.total).toBe(2);
      expect(d.attempts.successes).toBe(1);
      expect(d.attempts.failures).toBe(1);
      expect(d.attempts.recentFailures.length).toBeGreaterThanOrEqual(1);
      expect(d.attempts.recentFailures[0].approach).toContain('SQLite');
    });

    it('should include artifact count', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.artifacts.total).toBe(1);
    });
  });

  // ── ST3: Verification ───────────────────────────────────

  describe('ST3 — verification scores', () => {
    it('should include verification report summary', () => {
      const d = buildDashboard(root, projectId)!;
      expect(d.verification.reportCount).toBeGreaterThanOrEqual(1);
      expect(d.verification.latestReport).not.toBeNull();
    });

    it('should include verification scores', () => {
      const d = buildDashboard(root, projectId)!;
      const v = d.verification.latestReport!;

      expect(v.passed).toBe(true);
      expect(v.overallScore).toBeGreaterThan(0.5);
      expect(v.correctness).toBeGreaterThan(0.5);
      expect(v.completeness).toBeGreaterThan(0.5);
      expect(v.totalChecks).toBeGreaterThan(0);
      expect(v.passedChecks).toBeGreaterThan(0);
      expect(v.criticalFailures).toBe(0);
    });

    it('should handle project with no verification', () => {
      const emptyProj = createProject(root, { title: 'No Verify' }).data!;
      startSession(root, { projectId: emptyProj.id });

      const d = buildDashboard(root, emptyProj.id)!;
      expect(d.verification.reportCount).toBe(0);
      expect(d.verification.latestReport).toBeNull();
    });
  });

  // ── Empty project ───────────────────────────────────────

  describe('empty project', () => {
    it('should handle project with no data', () => {
      const emptyProj = createProject(root, { title: 'Empty' }).data!;
      startSession(root, { projectId: emptyProj.id });

      const d = buildDashboard(root, emptyProj.id)!;
      expect(d.events.total).toBe(0);
      expect(d.state.available).toBe(false);
      expect(d.tasks.total).toBe(0);
      expect(d.decisions.total).toBe(0);
      expect(d.attempts.total).toBe(0);
      expect(d.artifacts.total).toBe(0);
    });
  });
});
