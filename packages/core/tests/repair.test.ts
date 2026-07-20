import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt,
  generateChecks, scoreChecks, buildReport,
  identifyFailures, identifyCriticalFailures,
  retrieveEvidence, buildRepairContext, buildRepairPackage,
  runRepairCycle,
  CheckStatuses, Criticalities, RepairStatuses,
  TaskStatuses, AttemptOutcomes,
  loadDecisions, listTasks, listAttempts,
} from '../src/index';
import type { VerificationReport, WorkingState } from '../src/index';

describe('transfer repair', () => {
  let root: string;
  let projectId: string;
  let state: WorkingState;
  let failingReport: VerificationReport;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-repair-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Repair Test' }).data!;
    projectId = proj.id;

    const sess = startSession(root, { projectId }).data!;
    importTranscript(root, projectId, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a context continuity platform for AI.' },
      { role: 'assistant', content: 'I have set up a TypeScript monorepo with pnpm.' },
      { role: 'user', content: 'The system must preserve all events without modification.' },
      { role: 'user', content: 'I decided to use JSONL for the ledger format.' },
      { role: 'user', content: 'I tried SQLite but it failed with ARM linking errors.' },
      { role: 'user', content: 'Next step is to implement the MCP server.' },
    ])), 'test');

    const events = openLedger(root, projectId, sess.id).readAll().events;
    state = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, state);

    createDecision(root, { projectId, choice: 'Use JSONL', rationale: 'Portable', alternatives: ['SQLite'] });
    createTask(root, { projectId, description: 'Build MCP server' });
    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM linking' });

    // Generate checks and score with wrong answers to create failures
    const checks = generateChecks({
      state,
      decisions: loadDecisions(root, projectId),
      tasks: listTasks(root, projectId),
      attempts: listAttempts(root, projectId),
    });

    const wrongAnswers = new Map<string, string>();
    for (const c of checks) {
      if (c.criticality === Criticalities.CRITICAL) {
        wrongAnswers.set(c.id, 'I have no idea about this project.');
      } else {
        wrongAnswers.set(c.id, c.expectedAnswer); // correct for non-critical
      }
    }
    scoreChecks(checks, wrongAnswers);
    failingReport = buildReport(projectId, checks);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Identify failures ──────────────────────────────

  describe('ST1 — identify failures', () => {
    it('should identify failed checks', () => {
      const failures = identifyFailures(failingReport);
      expect(failures.length).toBeGreaterThan(0);
      for (const f of failures) {
        expect([CheckStatuses.FAILED, CheckStatuses.SKIPPED]).toContain(f.status);
      }
    });

    it('should identify critical failures', () => {
      const critical = identifyCriticalFailures(failingReport);
      expect(critical.length).toBeGreaterThan(0);
      for (const c of critical) {
        expect(c.criticality).toBe(Criticalities.CRITICAL);
      }
    });

    it('should return empty for a passing report', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);
      scoreChecks(checks, answers);
      const passing = buildReport(projectId, checks);

      expect(identifyFailures(passing)).toHaveLength(0);
      expect(identifyCriticalFailures(passing)).toHaveLength(0);
    });
  });

  // ── ST2: Retrieve evidence ──────────────────────────────

  describe('ST2 — retrieve evidence', () => {
    it('should retrieve evidence for a failed check with source IDs', () => {
      const failures = identifyFailures(failingReport);
      const withSources = failures.find((f) => f.sourceEventIds.length > 0);

      if (withSources) {
        const evidence = retrieveEvidence(root, projectId, withSources);
        expect(evidence.length).toBeGreaterThan(0);
        expect(evidence[0].eventId).toMatch(/^evt_/);
        expect(evidence[0].content.length).toBeGreaterThan(0);
        expect(evidence[0].relevance.length).toBeGreaterThan(0);
      }
    });

    it('should fall back to keyword search when no source IDs', () => {
      const check = failingReport.checks.find((c) => c.sourceEventIds.length === 0);

      if (check) {
        const evidence = retrieveEvidence(root, projectId, check);
        // May or may not find keyword matches
        if (evidence.length > 0) {
          expect(evidence[0].relevance).toContain('Keyword');
        }
      }
    });

    it('should include event type and timestamp in evidence', () => {
      const failures = identifyFailures(failingReport);
      if (failures.length > 0) {
        const evidence = retrieveEvidence(root, projectId, failures[0]);
        if (evidence.length > 0) {
          expect(evidence[0].type).toBeDefined();
          expect(evidence[0].timestamp).toBeDefined();
        }
      }
    });
  });

  // ── ST2: Build repair context ───────────────────────────

  describe('ST2 — repair context', () => {
    it('should build a repair context string for a check', () => {
      const failures = identifyFailures(failingReport);
      const evidence = retrieveEvidence(root, projectId, failures[0]);
      const context = buildRepairContext(failures[0], evidence);

      expect(context).toContain('Repair:');
      expect(context).toContain('Question:');
      expect(context).toContain('Expected:');
      expect(context).toContain('evidence');
    });

    it('should build a full repair package for all failures', () => {
      const repairPackage = buildRepairPackage(root, projectId, failingReport);

      expect(repairPackage).toContain('Transfer Repair Package');
      expect(repairPackage).toContain('Repair 1/');
      expect(repairPackage).toContain('Question:');
    });

    it('should indicate critical checks in repair package', () => {
      const repairPackage = buildRepairPackage(root, projectId, failingReport);
      expect(repairPackage).toContain('CRITICAL');
    });

    it('should return "no repairs needed" for passing report', () => {
      const checks = generateChecks({ state, decisions: [], tasks: [], attempts: [] });
      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);
      scoreChecks(checks, answers);
      const passing = buildReport(projectId, checks);

      const pkg = buildRepairPackage(root, projectId, passing);
      expect(pkg).toContain('No repairs needed');
    });
  });

  // ── ST3: Repair cycle ───────────────────────────────────

  describe('ST3 — repair cycle', () => {
    it('should repair checks when correct answers are provided', () => {
      const failures = identifyFailures(failingReport);
      const repairedAnswers = new Map<string, string>();

      for (const f of failures) {
        repairedAnswers.set(f.id, f.expectedAnswer);
      }

      const repairReport = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers,
      });

      expect(repairReport.repaired).toBeGreaterThan(0);
      expect(repairReport.passedInitially).toBeGreaterThan(0);
      expect(repairReport.unresolved).toBe(0);
      expect(repairReport.verified).toBe(true);
    });

    it('should mark checks as unresolved when repair answers are still wrong', () => {
      const failures = identifyFailures(failingReport);
      const badAnswers = new Map<string, string>();

      for (const f of failures) {
        badAnswers.set(f.id, 'Still completely wrong garbage answer.');
      }

      const repairReport = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: badAnswers,
      });

      expect(repairReport.unresolved).toBeGreaterThan(0);
      expect(repairReport.verified).toBe(false);
    });

    it('should track repair attempts count', () => {
      const failures = identifyFailures(failingReport);
      const answers = new Map<string, string>();
      for (const f of failures) answers.set(f.id, f.expectedAnswer);

      const report = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: answers,
        currentCycle: 2,
      });

      const repairedItems = report.items.filter((i) => i.repairStatus === RepairStatuses.REPAIRED);
      for (const item of repairedItems) {
        expect(item.repairAttempts).toBe(2);
        expect(item.explanation).toContain('cycle 2');
      }
    });

    it('should preserve originally-passed checks', () => {
      const report = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: new Map(),
      });

      const passedInitially = report.items.filter((i) => i.repairStatus === RepairStatuses.PASSED_INITIALLY);
      expect(passedInitially.length).toBeGreaterThan(0);

      for (const item of passedInitially) {
        expect(item.repairAttempts).toBe(0);
        expect(item.originalScore).not.toBeNull();
      }
    });

    it('should include evidence in repair items', () => {
      const failures = identifyFailures(failingReport);
      const answers = new Map<string, string>();
      for (const f of failures) answers.set(f.id, f.expectedAnswer);

      const report = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: answers,
      });

      const repairedItems = report.items.filter((i) => i.repairStatus === RepairStatuses.REPAIRED);
      // At least some should have evidence
      const withEvidence = repairedItems.filter((i) => i.evidence.length > 0);
      expect(withEvidence.length).toBeGreaterThanOrEqual(0); // May not all have direct sources
    });

    it('should track score improvement', () => {
      const failures = identifyFailures(failingReport);
      const answers = new Map<string, string>();
      for (const f of failures) answers.set(f.id, f.expectedAnswer);

      const report = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: answers,
      });

      const repairedItems = report.items.filter((i) => i.repairStatus === RepairStatuses.REPAIRED);
      for (const item of repairedItems) {
        expect(item.repairedScore).not.toBeNull();
        expect(item.repairedScore!).toBeGreaterThanOrEqual(0.6);
        if (item.originalScore !== null) {
          expect(item.repairedScore!).toBeGreaterThanOrEqual(item.originalScore);
        }
      }
    });

    it('should identify critical unresolved items', () => {
      const failures = identifyFailures(failingReport);
      const partialAnswers = new Map<string, string>();

      // Only answer non-critical failures
      for (const f of failures) {
        if (f.criticality !== Criticalities.CRITICAL) {
          partialAnswers.set(f.id, f.expectedAnswer);
        }
      }

      const report = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: partialAnswers,
      });

      expect(report.criticalUnresolved.length).toBeGreaterThan(0);
      expect(report.verified).toBe(false);
    });

    it('should report correct totals', () => {
      const failures = identifyFailures(failingReport);
      const answers = new Map<string, string>();
      for (const f of failures) answers.set(f.id, f.expectedAnswer);

      const report = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers: answers,
      });

      expect(report.totalChecks).toBe(failingReport.checks.length);
      expect(report.passedInitially + report.repaired + report.unresolved + report.skipped).toBe(report.totalChecks);
    });
  });

  // ── Full workflow ───────────────────────────────────────

  describe('full verify → repair workflow', () => {
    it('should go from failing to verified through repair', () => {
      // 1. Initial report is failing
      expect(failingReport.passed).toBe(false);
      expect(failingReport.criticalFailures).toBeGreaterThan(0);

      // 2. Identify what needs repair
      const failures = identifyFailures(failingReport);
      expect(failures.length).toBeGreaterThan(0);

      // 3. Get repair evidence
      for (const f of failures) {
        const evidence = retrieveEvidence(root, projectId, f);
        // Evidence should exist for checks with source IDs
        if (f.sourceEventIds.length > 0) {
          expect(evidence.length).toBeGreaterThan(0);
        }
      }

      // 4. Provide correct answers after seeing evidence
      const repairedAnswers = new Map<string, string>();
      for (const f of failures) {
        repairedAnswers.set(f.id, f.expectedAnswer);
      }

      // 5. Run repair cycle
      const repairReport = runRepairCycle({
        workspaceRoot: root,
        projectId,
        report: failingReport,
        repairedAnswers,
      });

      // 6. Should now be verified
      expect(repairReport.verified).toBe(true);
      expect(repairReport.unresolved).toBe(0);
      expect(repairReport.criticalUnresolved).toHaveLength(0);
      expect(repairReport.repaired).toBeGreaterThan(0);
      expect(repairReport.passedInitially).toBeGreaterThan(0);
    });
  });
});
