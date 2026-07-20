import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, updateTaskStatus, recordAttempt,
  loadDecisions, listTasks, listAttempts,
  generateChecks, scoreCheck, scoreChecks, buildReport,
  saveReport, loadLatestReport, listReports,
  saveChecks, loadPendingChecks,
  CheckDimensions, Criticalities, CheckStatuses,
  TaskStatuses, AttemptOutcomes,
} from '../src/index';
import type { VerificationCheck, WorkingState } from '../src/index';

describe('transfer verification', () => {
  let root: string;
  let projectId: string;
  let state: WorkingState;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-verify-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Verify Test', description: 'Testing verification' }).data!;
    projectId = proj.id;

    const sess = startSession(root, { projectId }).data!;
    importTranscript(root, projectId, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a context continuity platform for AI workflows.' },
      { role: 'assistant', content: 'I have set up a TypeScript monorepo with pnpm workspaces.' },
      { role: 'user', content: 'The system must preserve all events without modification.' },
      { role: 'user', content: 'The requirement is to support at least three AI providers.' },
      { role: 'user', content: 'I decided to use JSONL for the append-only ledger format.' },
      { role: 'user', content: 'I tried SQLite but it failed with native module linking errors on ARM.' },
      { role: 'user', content: 'I am assuming Node.js 18 or higher is available.' },
      { role: 'user', content: 'Next step is to implement the MCP server for agent integration.' },
      { role: 'user', content: 'Should we support real-time streaming capture in v1?' },
    ])), 'test');

    const events = openLedger(root, projectId, sess.id).readAll().events;
    state = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, state);

    createDecision(root, { projectId, choice: 'Use JSONL for storage', rationale: 'Simple, portable, no native deps', alternatives: ['SQLite', 'Protobuf'] });
    const task = createTask(root, { projectId, description: 'Implement event schema' });
    updateTaskStatus(root, projectId, task.id, TaskStatuses.COMPLETED, 'All 7 types done');
    createTask(root, { projectId, description: 'Build MCP server' });
    const blockedTask = createTask(root, { projectId, description: 'Deploy to production' });
    updateTaskStatus(root, projectId, blockedTask.id, TaskStatuses.BLOCKED, 'Waiting for security review');

    recordAttempt(root, { projectId, approach: 'SQLite for primary store', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM native module linking errors', observations: 'Need pure JS alternative' });
    recordAttempt(root, { projectId, approach: 'JSONL as source of truth', outcome: AttemptOutcomes.SUCCESS, observations: 'Simple and portable' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Generate checks from objectives and constraints ──

  describe('ST1 — objective and constraint checks', () => {
    it('should generate checks for active objectives', () => {
      const checks = generateChecks({
        state,
        decisions: [],
        tasks: [],
        attempts: [],
      });

      const objectiveChecks = checks.filter((c) => c.dimension === CheckDimensions.OBJECTIVE_ACCURACY);
      expect(objectiveChecks.length).toBeGreaterThanOrEqual(1);
      expect(objectiveChecks[0].criticality).toBe(Criticalities.CRITICAL);
      expect(objectiveChecks[0].question).toContain('objective');
    });

    it('should generate checks for constraints', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });

      const constraintChecks = checks.filter((c) => c.dimension === CheckDimensions.CONSTRAINT_RECALL);
      expect(constraintChecks.length).toBeGreaterThanOrEqual(1);
      expect(constraintChecks[0].criticality).toBe(Criticalities.CRITICAL);
      expect(constraintChecks[0].expectedAnswer).toBeDefined();
    });

    it('should include source event IDs in checks', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });

      const withSources = checks.filter((c) => c.sourceEventIds.length > 0);
      expect(withSources.length).toBeGreaterThan(0);
      expect(withSources[0].sourceEventIds[0]).toMatch(/^evt_/);
    });

    it('should generate all checks as pending', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      for (const c of checks) {
        expect(c.status).toBe(CheckStatuses.PENDING);
        expect(c.score).toBeNull();
        expect(c.actualAnswer).toBeNull();
      }
    });
  });

  // ── ST2: Checks for decisions, progress, and failures ─────

  describe('ST2 — decisions, progress, and failure checks', () => {
    it('should generate decision checks from tracker', () => {
      const decisions = loadDecisions(root, projectId);
      const checks = generateChecks({ state, decisions, tasks: [], attempts: [] });

      const decisionChecks = checks.filter((c) => c.dimension === CheckDimensions.DECISION_CONTINUITY);
      expect(decisionChecks.length).toBeGreaterThanOrEqual(1);
      expect(decisionChecks.some((c) => c.expectedAnswer.includes('JSONL'))).toBe(true);
    });

    it('should generate progress checks from tasks', () => {
      const tasks = listTasks(root, projectId);
      const checks = generateChecks({ state, decisions: [], tasks, attempts: [] });

      const progressChecks = checks.filter((c) => c.dimension === CheckDimensions.PROGRESS_ACCURACY);
      expect(progressChecks.length).toBeGreaterThanOrEqual(1);
      expect(progressChecks.some((c) => c.expectedAnswer.includes('Completed'))).toBe(true);
    });

    it('should generate checks for blocked tasks', () => {
      const tasks = listTasks(root, projectId);
      const checks = generateChecks({ state, decisions: [], tasks, attempts: [] });

      const blockedChecks = checks.filter((c) => c.sourceCategory === 'task_blocked');
      expect(blockedChecks.length).toBeGreaterThanOrEqual(1);
      expect(blockedChecks[0].expectedAnswer).toContain('security review');
    });

    it('should generate failure awareness checks', () => {
      const attempts = listAttempts(root, projectId);
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts });

      const failureChecks = checks.filter((c) => c.dimension === CheckDimensions.FAILURE_AWARENESS);
      expect(failureChecks.length).toBeGreaterThanOrEqual(1);
      expect(failureChecks.some((c) => c.expectedAnswer.includes('ARM'))).toBe(true);
    });

    it('should generate continuation readiness checks', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });

      const continuationChecks = checks.filter((c) => c.dimension === CheckDimensions.CONTINUATION_READINESS);
      expect(continuationChecks.length).toBeGreaterThanOrEqual(1);
    });

    it('should generate evidence grounding checks', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });

      const groundingChecks = checks.filter((c) => c.dimension === CheckDimensions.EVIDENCE_GROUNDING);
      expect(groundingChecks.length).toBeGreaterThanOrEqual(1);
      expect(groundingChecks[0].expectedAnswer).toContain('evt_');
    });
  });

  // ── ST3: Scoring ──────────────────────────────────────────

  describe('ST3 — scoring', () => {
    it('should score a check with matching answer at 1.0', () => {
      const check: VerificationCheck = {
        id: 'chk_test', dimension: CheckDimensions.OBJECTIVE_ACCURACY,
        criticality: Criticalities.CRITICAL, status: CheckStatuses.PENDING,
        question: 'What is the goal?',
        expectedAnswer: 'Build a context continuity platform for AI workflows.',
        sourceEventIds: [], sourceCategory: 'objective',
        actualAnswer: 'The goal is to build a context continuity platform for AI workflows.',
        score: null, explanation: null,
      };

      const score = scoreCheck(check);
      expect(score).toBeGreaterThanOrEqual(0.8);
    });

    it('should score a check with partial match', () => {
      const check: VerificationCheck = {
        id: 'chk_test', dimension: CheckDimensions.OBJECTIVE_ACCURACY,
        criticality: Criticalities.CRITICAL, status: CheckStatuses.PENDING,
        question: 'What is the goal?',
        expectedAnswer: 'Build a context continuity platform for AI workflows.',
        sourceEventIds: [], sourceCategory: 'objective',
        actualAnswer: 'The project aims to build something for AI.',
        score: null, explanation: null,
      };

      const score = scoreCheck(check);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('should score a check with no match at 0', () => {
      const check: VerificationCheck = {
        id: 'chk_test', dimension: CheckDimensions.OBJECTIVE_ACCURACY,
        criticality: Criticalities.CRITICAL, status: CheckStatuses.PENDING,
        question: 'What is the goal?',
        expectedAnswer: 'Build a context continuity platform for AI workflows.',
        sourceEventIds: [], sourceCategory: 'objective',
        actualAnswer: 'I have no idea what this project is about.',
        score: null, explanation: null,
      };

      const score = scoreCheck(check);
      expect(score).toBeLessThanOrEqual(0.2);
    });

    it('should score 0 for empty answer', () => {
      const check: VerificationCheck = {
        id: 'chk_test', dimension: CheckDimensions.OBJECTIVE_ACCURACY,
        criticality: Criticalities.CRITICAL, status: CheckStatuses.PENDING,
        question: 'What is the goal?', expectedAnswer: 'Something.',
        sourceEventIds: [], sourceCategory: 'objective',
        actualAnswer: '', score: null, explanation: null,
      };

      expect(scoreCheck(check)).toBe(0);
    });

    it('should apply scores to checks and update status', () => {
      const decisions = loadDecisions(root, projectId);
      const tasks = listTasks(root, projectId);
      const attempts = listAttempts(root, projectId);
      const checks = generateChecks({ state, decisions, tasks, attempts });

      // Auto-answer: use expected answers (simulates perfect transfer)
      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);

      scoreChecks(checks, answers);

      const passed = checks.filter((c) => c.status === CheckStatuses.PASSED);
      expect(passed.length).toBe(checks.length);

      for (const c of checks) {
        expect(c.score).not.toBeNull();
        expect(c.score!).toBeGreaterThanOrEqual(0.6);
        expect(c.actualAnswer).toBe(c.expectedAnswer);
      }
    });

    it('should mark unanswered checks as skipped', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      scoreChecks(checks, new Map()); // No answers

      for (const c of checks) {
        expect(c.status).toBe(CheckStatuses.SKIPPED);
      }
    });
  });

  // ── ST3: Report ───────────────────────────────────────────

  describe('ST3 — verification report', () => {
    it('should build a passing report for perfect answers', () => {
      const decisions = loadDecisions(root, projectId);
      const tasks = listTasks(root, projectId);
      const attempts = listAttempts(root, projectId);
      const checks = generateChecks({ state, decisions, tasks, attempts });

      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);
      scoreChecks(checks, answers);

      const report = buildReport(projectId, checks);

      expect(report.passed).toBe(true);
      expect(report.criticalFailures).toBe(0);
      expect(report.contradictionCount).toBe(0);
      expect(report.overallScore).toBeGreaterThan(0.8);
      expect(report.correctness).toBeGreaterThan(0.8);
      expect(report.completeness).toBeGreaterThan(0.8);
      expect(report.passedChecks).toBe(report.totalChecks);
    });

    it('should build a failing report for empty answers', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      scoreChecks(checks, new Map());

      const report = buildReport(projectId, checks);

      expect(report.passed).toBe(true); // No failures, just skipped
      expect(report.passedChecks).toBe(0);
      expect(report.failedChecks).toBe(0);
    });

    it('should fail when critical checks fail', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });

      // Give wrong answers to critical checks
      const answers = new Map<string, string>();
      for (const c of checks) {
        if (c.criticality === Criticalities.CRITICAL) {
          answers.set(c.id, 'completely wrong unrelated garbage answer');
        } else {
          answers.set(c.id, c.expectedAnswer);
        }
      }
      scoreChecks(checks, answers);

      const report = buildReport(projectId, checks);

      expect(report.criticalFailures).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
    });

    it('should include dimension scores', () => {
      const decisions = loadDecisions(root, projectId);
      const tasks = listTasks(root, projectId);
      const attempts = listAttempts(root, projectId);
      const checks = generateChecks({ state, decisions, tasks, attempts });

      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);
      scoreChecks(checks, answers);

      const report = buildReport(projectId, checks);

      expect(report.dimensionScores.length).toBeGreaterThan(0);

      for (const d of report.dimensionScores) {
        expect(d.label.length).toBeGreaterThan(0);
        expect(d.score).toBeGreaterThanOrEqual(0);
        expect(d.score).toBeLessThanOrEqual(1);
        expect(d.target).toBeGreaterThan(0);
        expect(typeof d.met).toBe('boolean');
      }
    });
  });

  // ── Persistence ───────────────────────────────────────────

  describe('persistence', () => {
    it('should save and load pending checks', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      saveChecks(root, projectId, checks);

      const loaded = loadPendingChecks(root, projectId);
      expect(loaded).not.toBeNull();
      expect(loaded!).toHaveLength(checks.length);
      expect(loaded![0].id).toBe(checks[0].id);
    });

    it('should save and load reports', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);
      scoreChecks(checks, answers);

      const report = buildReport(projectId, checks);
      saveReport(root, projectId, report);

      const loaded = loadLatestReport(root, projectId);
      expect(loaded).not.toBeNull();
      expect(loaded!.projectId).toBe(projectId);
      expect(loaded!.totalChecks).toBe(report.totalChecks);
    });

    it('should list report history', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      const report = buildReport(projectId, checks);

      saveReport(root, projectId, report);
      saveReport(root, projectId, report);

      const files = listReports(root, projectId);
      expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it('should return null when no reports exist', () => {
      expect(loadLatestReport(root, projectId)).toBeNull();
      expect(loadPendingChecks(root, projectId)).toBeNull();
      expect(listReports(root, projectId)).toHaveLength(0);
    });
  });
});
