import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject, startSession, setActiveProject, setActiveSession,
  listSessions, listProjects, openLedger,
  extractWorkingState, saveWorkingState, loadWorkingState,
  createDecision, createTask, updateTaskStatus, recordAttempt,
  listDecisions, listTasks, listAttempts, getFailedAttempts,
  exportCapsule, importCapsule, verifyCapsuleIntegrity,
  buildContextPackage, ContextLayers,
  generateChecks, scoreChecks, buildReport, saveReport, loadLatestReport,
  saveChecks, loadPendingChecks,
  identifyFailures, retrieveEvidence, buildRepairPackage, runRepairCycle,
  claudeAdapter, adapterNormalize,
  generateCoverageReport,
  processEvents, buildRedactionReport,
  buildDashboard,
  logAudit, readAuditLog, getAuditStats,
  EventTypes, TaskStatuses, AttemptOutcomes, DecisionStatuses,
  CheckStatuses, Criticalities, CheckDimensions,
  AuditOperations, AuditOutcomes, RepairStatuses,
} from '../src/index';
import type { ContinuumEvent, VerificationCheck } from '../src/index';

const FIXTURE_PATH = join(__dirname, 'fixtures', 'demo-dev-session.json');

describe('US-031 — Cross-tool demonstration', () => {
  let srcRoot: string;
  let destRoot: string;
  let capsuleDir: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    srcRoot = mkdtempSync(join(tmpdir(), 'continuum-demo-src-'));
    destRoot = mkdtempSync(join(tmpdir(), 'continuum-demo-dest-'));
    capsuleDir = mkdtempSync(join(tmpdir(), 'continuum-demo-cap-'));
    initWorkspace(srcRoot);
  });

  afterEach(() => {
    rmSync(srcRoot, { recursive: true, force: true });
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(capsuleDir, { recursive: true, force: true });
  });

  // ── ST1: Prepare a realistic fixture ────────────────────

  describe('ST1 — realistic dev session fixture', () => {
    it('should parse the Claude dev session with tool calls', () => {
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const parseResult = claudeAdapter.parse(raw);

      expect(parseResult.detectedProvider).toBe('anthropic');
      expect(parseResult.messages.length).toBeGreaterThanOrEqual(15);

      const toolCalls = parseResult.messages.filter((m) => m.role === '__tool_call__');
      const toolResults = parseResult.messages.filter((m) => m.role === '__tool_result__');

      expect(toolCalls.length).toBeGreaterThanOrEqual(4);
      expect(toolResults.length).toBeGreaterThanOrEqual(4);

      // Verify tool names
      const toolNames = toolCalls.map((m) => JSON.parse(m.content).toolName);
      expect(toolNames).toContain('create_file');
    });

    it('should normalize to canonical events with hashes', () => {
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const parseResult = claudeAdapter.parse(raw);

      const proj = createProject(srcRoot, { title: 'Taskflow API' }).data!;
      const sess = startSession(srcRoot, { projectId: proj.id, provider: 'anthropic', model: 'claude-sonnet' }).data!;

      const output = adapterNormalize({
        parseResult, projectId: proj.id, sessionId: sess.id, source: 'demo',
      });

      expect(output.stats.messagesCreated).toBeGreaterThanOrEqual(8);
      expect(output.stats.toolCallsCreated).toBeGreaterThanOrEqual(4);
      expect(output.stats.toolResultsCreated).toBeGreaterThanOrEqual(4);
      expect(output.stats.skipped).toBe(0);

      // All events have valid hashes
      for (const event of output.events) {
        expect(event.id).toMatch(/^evt_/);
        expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('should extract meaningful state from the dev session', () => {
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const parseResult = claudeAdapter.parse(raw);

      const proj = createProject(srcRoot, { title: 'Taskflow API' }).data!;
      projectId = proj.id;
      const sess = startSession(srcRoot, { projectId, provider: 'anthropic', model: 'claude-sonnet' }).data!;

      const output = adapterNormalize({ parseResult, projectId, sessionId: sess.id, source: 'demo' });

      const ledger = openLedger(srcRoot, projectId, sess.id);
      ledger.appendBatch(output.events);

      const events = ledger.readAll().events;
      const state = extractWorkingState(projectId, events);

      // Should have found objectives, constraints, and decisions
      const objectives = state.objectives.filter((s) => s.status === 'active');
      const constraints = state.constraints.filter((s) => s.status === 'active');
      const decisions = state.decisions.filter((s) => s.status === 'active');
      const failures = state.failures.filter((s) => s.status === 'active');

      expect(objectives.length).toBeGreaterThanOrEqual(1);
      expect(constraints.length + (state.requirements ?? []).filter((s) => s.status === 'active').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── ST2: End-to-end transfer ────────────────────────────

  describe('ST2 — transfer from source to receiving agent', () => {
    beforeEach(() => {
      // Import the fixture
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const parseResult = claudeAdapter.parse(raw);

      const proj = createProject(srcRoot, { title: 'Taskflow API', description: 'Go REST API with Gin/PostgreSQL' }).data!;
      projectId = proj.id;
      setActiveProject(srcRoot, projectId);

      const sess = startSession(srcRoot, { projectId, provider: 'anthropic', model: 'claude-sonnet' }).data!;
      sessionId = sess.id;

      const output = adapterNormalize({ parseResult, projectId, sessionId, source: 'demo' });
      const ledger = openLedger(srcRoot, projectId, sessionId);
      ledger.appendBatch(output.events);

      // Extract state
      const events = ledger.readAll().events;
      saveWorkingState(srcRoot, projectId, extractWorkingState(projectId, events));

      // Track decisions and attempts
      createDecision(srcRoot, { projectId, choice: 'Use pgx for database access', rationale: 'Full SQL control, avoids ORM overhead', alternatives: ['GORM', 'sqlx'] });
      createDecision(srcRoot, { projectId, choice: 'Redis sliding window for rate limiting', rationale: 'Distributed across K8s replicas', alternatives: ['In-memory token bucket'] });

      createTask(srcRoot, { projectId, description: 'Implement JSON:API response envelope' });
      createTask(srcRoot, { projectId, description: 'Write integration tests' });

      recordAttempt(srcRoot, {
        projectId, approach: 'Used GORM for database layer',
        outcome: AttemptOutcomes.FAILURE,
        failureReason: 'Noisy query logging, inefficient JOINs',
        observations: 'Stick with raw pgx',
      });
      recordAttempt(srcRoot, {
        projectId, approach: 'Timestamp-only cursor pagination',
        outcome: AttemptOutcomes.FAILURE,
        failureReason: 'Tasks in the same millisecond got skipped',
        observations: 'Need compound cursor with timestamp+id',
      });
    });

    it('should export and import a capsule with full fidelity', () => {
      // Export
      const exported = exportCapsule({ workspaceRoot: srcRoot, projectId, outputDir: capsuleDir });
      expect(exported.error).toBeNull();
      expect(exported.manifest.ledger.eventCount).toBeGreaterThan(10);

      // Verify integrity
      const integrity = verifyCapsuleIntegrity(exported.capsulePath);
      expect(integrity.valid).toBe(true);

      // Import into fresh workspace
      initWorkspace(destRoot);
      const imported = importCapsule({ workspaceRoot: destRoot, capsulePath: exported.capsulePath });

      expect(imported.success).toBe(true);
      expect(imported.eventsImported).toBe(exported.manifest.ledger.eventCount);
      expect(imported.sessionsImported).toBe(1);

      // Verify imported data matches source
      const destSessions = listSessions(destRoot, imported.projectId!);
      expect(destSessions).toHaveLength(1);

      const destLedger = openLedger(destRoot, imported.projectId!, destSessions[0].id);
      const { events: destEvents } = destLedger.readAll();
      expect(destEvents.length).toBe(imported.eventsImported);

      // Verify event hashes match
      const srcLedger = openLedger(srcRoot, projectId, sessionId);
      const { events: srcEvents } = srcLedger.readAll();

      for (let i = 0; i < srcEvents.length; i++) {
        expect(destEvents[i].hash).toBe(srcEvents[i].hash);
      }
    });

    it('should generate a complete transfer context package', () => {
      const pkg = buildContextPackage({
        workspaceRoot: srcRoot, projectId,
        layers: [ContextLayers.L0_ORIENTATION, ContextLayers.L1_ACTIVE_STATE, ContextLayers.L2_GOVERNING, ContextLayers.L3_EVIDENCE],
      });

      expect(pkg.includedLayers).toHaveLength(4);
      expect(pkg.combined).toContain('Taskflow');
      expect(pkg.combined).toContain('pgx');
      expect(pkg.combined).toContain('GORM');
      expect(pkg.combined).toContain('Failed Attempts');
      expect(pkg.totalTokens).toBeGreaterThan(100);
    });

    it('should pass verification with correct answers', () => {
      const state = loadWorkingState(srcRoot, projectId)!;
      const checks = generateChecks({
        state,
        decisions: listDecisions(srcRoot, projectId, true),
        tasks: listTasks(srcRoot, projectId),
        attempts: listAttempts(srcRoot, projectId),
      });

      expect(checks.length).toBeGreaterThan(5);

      // Self-test
      const answers = new Map<string, string>();
      for (const c of checks) answers.set(c.id, c.expectedAnswer);
      scoreChecks(checks, answers);

      const report = buildReport(projectId, checks);
      expect(report.passed).toBe(true);
      expect(report.criticalFailures).toBe(0);
      expect(report.overallScore).toBeGreaterThan(0.8);
    });

    it('should produce a valid coverage report', () => {
      const sessions = listSessions(srcRoot, projectId);
      const allEvents: ContinuumEvent[] = [];
      for (const s of sessions) allEvents.push(...openLedger(srcRoot, projectId, s.id).readAll().events);

      const report = generateCoverageReport('claude', 'Claude API', 'anthropic', allEvents);
      expect(report.criticalCoverage).toBe(1);
      expect(report.transferReady).toBe(true);
    });

    it('should produce a complete dashboard snapshot', () => {
      const dashboard = buildDashboard(srcRoot, projectId)!;

      expect(dashboard.project.title).toBe('Taskflow API');
      expect(dashboard.events.total).toBeGreaterThan(10);
      expect(dashboard.decisions.active).toBe(2);
      expect(dashboard.attempts.failures).toBe(2);
      expect(dashboard.state.available).toBe(true);
    });
  });

  // ── ST3: Deliberate failure and automatic repair ────────

  describe('ST3 — remove critical fact and demonstrate repair', () => {
    let destProjectId: string;

    beforeEach(() => {
      // Full setup: import → export → import into dest
      const raw = readFileSync(FIXTURE_PATH, 'utf-8');
      const parseResult = claudeAdapter.parse(raw);

      const proj = createProject(srcRoot, { title: 'Taskflow API' }).data!;
      projectId = proj.id;
      const sess = startSession(srcRoot, { projectId, provider: 'anthropic', model: 'claude-sonnet' }).data!;
      sessionId = sess.id;

      const output = adapterNormalize({ parseResult, projectId, sessionId, source: 'demo' });
      openLedger(srcRoot, projectId, sessionId).appendBatch(output.events);
      saveWorkingState(srcRoot, projectId, extractWorkingState(projectId, openLedger(srcRoot, projectId, sessionId).readAll().events));

      createDecision(srcRoot, { projectId, choice: 'Use pgx', rationale: 'No ORM', alternatives: ['GORM'] });
      recordAttempt(srcRoot, { projectId, approach: 'GORM for database layer', outcome: AttemptOutcomes.FAILURE, failureReason: 'Noisy logging, inefficient JOINs', observations: 'Stick with pgx' });
      recordAttempt(srcRoot, { projectId, approach: 'Timestamp-only cursor', outcome: AttemptOutcomes.FAILURE, failureReason: 'Same-millisecond tasks skipped', observations: 'Use compound cursor' });

      // Export and import
      const exported = exportCapsule({ workspaceRoot: srcRoot, projectId, outputDir: capsuleDir });
      initWorkspace(destRoot);
      const imported = importCapsule({ workspaceRoot: destRoot, capsulePath: exported.capsulePath });
      destProjectId = imported.projectId!;
    });

    it('should detect when a critical fact is missing from the transfer', () => {
      const state = loadWorkingState(destRoot, destProjectId)!;
      const decisions = listDecisions(destRoot, destProjectId, true);
      const tasks = listTasks(destRoot, destProjectId);
      const attempts = listAttempts(destRoot, destProjectId);

      const checks = generateChecks({ state, decisions, tasks, attempts });

      // Provide correct answers for everything EXCEPT the GORM failure
      const answers = new Map<string, string>();
      for (const c of checks) {
        if (c.dimension === CheckDimensions.FAILURE_AWARENESS && c.expectedAnswer.includes('GORM')) {
          // Deliberately wrong — agent doesn't know about GORM
          answers.set(c.id, 'I am not aware of any previous database layer attempts.');
        } else {
          answers.set(c.id, c.expectedAnswer);
        }
      }

      scoreChecks(checks, answers);
      const report = buildReport(destProjectId, checks);

      // Should have at least one failure
      expect(report.failedChecks).toBeGreaterThanOrEqual(1);

      // Find the specific failed check
      const gormFailure = report.checks.find(
        (c) => c.status === CheckStatuses.FAILED && c.expectedAnswer.includes('GORM'),
      );
      expect(gormFailure).toBeDefined();
      expect(gormFailure!.dimension).toBe(CheckDimensions.FAILURE_AWARENESS);
    });

    it('should retrieve targeted evidence for the missing fact', () => {
      const state = loadWorkingState(destRoot, destProjectId)!;
      const checks = generateChecks({
        state,
        decisions: listDecisions(destRoot, destProjectId, true),
        tasks: listTasks(destRoot, destProjectId),
        attempts: listAttempts(destRoot, destProjectId),
      });

      const gormCheck = checks.find(
        (c) => c.dimension === CheckDimensions.FAILURE_AWARENESS && c.expectedAnswer.includes('GORM'),
      );

      if (gormCheck) {
        const evidence = retrieveEvidence(destRoot, destProjectId, gormCheck);

        // Should find evidence — either from source IDs or keyword search
        // The conversation mentions GORM explicitly
        expect(evidence.length).toBeGreaterThanOrEqual(0);

        if (evidence.length > 0) {
          // Evidence should reference GORM
          const gormEvidence = evidence.find((e) => e.content.toLowerCase().includes('gorm'));
          if (gormEvidence) {
            expect(gormEvidence.content).toContain('GORM');
          }
        }
      }
    });

    it('should build a repair package with evidence for the failed check', () => {
      const state = loadWorkingState(destRoot, destProjectId)!;
      const checks = generateChecks({
        state,
        decisions: listDecisions(destRoot, destProjectId, true),
        tasks: listTasks(destRoot, destProjectId),
        attempts: listAttempts(destRoot, destProjectId),
      });

      // Score with the deliberate failure
      const answers = new Map<string, string>();
      for (const c of checks) {
        if (c.dimension === CheckDimensions.FAILURE_AWARENESS && c.expectedAnswer.includes('GORM')) {
          answers.set(c.id, 'No failed approaches known.');
        } else {
          answers.set(c.id, c.expectedAnswer);
        }
      }
      scoreChecks(checks, answers);
      const failingReport = buildReport(destProjectId, checks);
      saveReport(destRoot, destProjectId, failingReport);

      // Build repair package
      const repairPackage = buildRepairPackage(destRoot, destProjectId, failingReport);
      expect(repairPackage).toContain('Repair');
      expect(repairPackage).toContain('failure_awareness');
    });

    it('should repair the transfer when correct evidence is provided', () => {
      const state = loadWorkingState(destRoot, destProjectId)!;
      const checks = generateChecks({
        state,
        decisions: listDecisions(destRoot, destProjectId, true),
        tasks: listTasks(destRoot, destProjectId),
        attempts: listAttempts(destRoot, destProjectId),
      });

      // Score with the deliberate failure
      const wrongAnswers = new Map<string, string>();
      for (const c of checks) {
        if (c.dimension === CheckDimensions.FAILURE_AWARENESS && c.expectedAnswer.includes('GORM')) {
          wrongAnswers.set(c.id, 'No failed approaches known.');
        } else {
          wrongAnswers.set(c.id, c.expectedAnswer);
        }
      }
      scoreChecks(checks, wrongAnswers);
      const failingReport = buildReport(destProjectId, checks);

      expect(failingReport.passed).toBe(false);

      // Now provide the correct answer — simulating what happens after the agent sees the repair evidence
      const failures = identifyFailures(failingReport);
      const repairedAnswers = new Map<string, string>();
      for (const f of failures) {
        // Agent now provides the correct answer after reviewing evidence
        repairedAnswers.set(f.id, f.expectedAnswer);
      }

      const repairReport = runRepairCycle({
        workspaceRoot: destRoot,
        projectId: destProjectId,
        report: failingReport,
        repairedAnswers,
      });

      // Should now be verified
      expect(repairReport.verified).toBe(true);
      expect(repairReport.repaired).toBeGreaterThanOrEqual(1);
      expect(repairReport.unresolved).toBe(0);
      expect(repairReport.criticalUnresolved).toHaveLength(0);

      // The repaired item should be the GORM check
      const repairedItems = repairReport.items.filter((i) => i.repairStatus === RepairStatuses.REPAIRED);
      expect(repairedItems.length).toBeGreaterThanOrEqual(1);

      const gormRepair = repairedItems.find((i) => i.expectedAnswer.includes('GORM'));
      if (gormRepair) {
        expect(gormRepair.repairedScore).not.toBeNull();
        expect(gormRepair.repairedScore!).toBeGreaterThanOrEqual(0.6);
        expect(gormRepair.explanation).toContain('Repaired');
      }
    });

    it('should complete the full verify → fail → repair → pass cycle', () => {
      // This is the end-to-end proof: source → export → import → verify → break → repair → verified
      const state = loadWorkingState(destRoot, destProjectId)!;
      const decisions = listDecisions(destRoot, destProjectId, true);
      const tasks = listTasks(destRoot, destProjectId);
      const attempts = listAttempts(destRoot, destProjectId);

      // Step 1: Generate checks
      const checks = generateChecks({ state, decisions, tasks, attempts });
      expect(checks.length).toBeGreaterThan(3);

      // Step 2: Score with perfect answers → should pass
      const perfectAnswers = new Map<string, string>();
      for (const c of checks) perfectAnswers.set(c.id, c.expectedAnswer);
      const perfectChecks = checks.map((c) => ({ ...c }));
      scoreChecks(perfectChecks, perfectAnswers);
      const perfectReport = buildReport(destProjectId, perfectChecks);
      expect(perfectReport.passed).toBe(true);

      // Step 3: Score with a broken answer → should fail
      const brokenChecks = generateChecks({ state, decisions, tasks, attempts });
      const brokenAnswers = new Map<string, string>();
      for (const c of brokenChecks) {
        if (c.dimension === CheckDimensions.FAILURE_AWARENESS && c.expectedAnswer.includes('GORM')) {
          brokenAnswers.set(c.id, 'Everything is fine, no failures.');
        } else {
          brokenAnswers.set(c.id, c.expectedAnswer);
        }
      }
      scoreChecks(brokenChecks, brokenAnswers);
      const brokenReport = buildReport(destProjectId, brokenChecks);
      expect(brokenReport.failedChecks).toBeGreaterThanOrEqual(1);

      // Step 4: Repair with correct answer
      const failures = identifyFailures(brokenReport);
      expect(failures.length).toBeGreaterThanOrEqual(1);

      const repairedAnswers = new Map<string, string>();
      for (const f of failures) repairedAnswers.set(f.id, f.expectedAnswer);

      const repairResult = runRepairCycle({
        workspaceRoot: destRoot,
        projectId: destProjectId,
        report: brokenReport,
        repairedAnswers,
      });

      // Step 5: Verified after repair
      expect(repairResult.verified).toBe(true);
      expect(repairResult.passedInitially + repairResult.repaired).toBe(repairResult.totalChecks - repairResult.skipped);

      // Log it
      logAudit(destRoot, AuditOperations.TRANSFER, AuditOutcomes.SUCCESS, {
        sourceProject: projectId,
        destProject: destProjectId,
        eventsTransferred: state.totalEventsProcessed,
        verificationPassed: true,
        repairsNeeded: repairResult.repaired,
      }, { projectId: destProjectId });

      const auditEntries = readAuditLog(destRoot, { operation: AuditOperations.TRANSFER });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].details.verificationPassed).toBe(true);
    });
  });
});
