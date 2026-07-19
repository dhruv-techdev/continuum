import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject,
  createDecision, listDecisions, getDecision, rejectDecision, supersedeDecision, DecisionStatuses,
  createTask, listTasks, updateTaskStatus, getTask, TaskStatuses,
  recordAttempt, listAttempts, getFailedAttempts, getAttempt, AttemptOutcomes,
} from '../src/index';

describe('tracking', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-tracking-'));
    initWorkspace(root);
    projectId = createProject(root, { title: 'Track Test' }).data!.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ═══════════ ST1: Decisions ════════════════════════════

  describe('decisions', () => {
    it('should create an active decision', () => {
      const d = createDecision(root, {
        projectId,
        choice: 'Use JSONL for storage',
        rationale: 'Simple, append-only, human-readable',
        alternatives: ['SQLite', 'Protobuf'],
      });
      expect(d.id).toMatch(/^dec_/);
      expect(d.status).toBe(DecisionStatuses.ACTIVE);
      expect(d.choice).toBe('Use JSONL for storage');
      expect(d.alternatives).toEqual(['SQLite', 'Protobuf']);
    });

    it('should persist and reload decisions', () => {
      createDecision(root, { projectId, choice: 'One' });
      createDecision(root, { projectId, choice: 'Two' });
      expect(listDecisions(root, projectId)).toHaveLength(2);
    });

    it('should reject a decision', () => {
      const d = createDecision(root, { projectId, choice: 'Use XML' });
      const rejected = rejectDecision(root, projectId, d.id, 'Too verbose');
      expect(rejected!.status).toBe(DecisionStatuses.REJECTED);
      expect(rejected!.rejectionReason).toBe('Too verbose');
    });

    it('should exclude rejected from default list', () => {
      const d = createDecision(root, { projectId, choice: 'Bad choice' });
      createDecision(root, { projectId, choice: 'Good choice' });
      rejectDecision(root, projectId, d.id, 'Wrong');

      expect(listDecisions(root, projectId)).toHaveLength(1);
      expect(listDecisions(root, projectId, true)).toHaveLength(2);
    });

    it('should supersede a decision', () => {
      const old = createDecision(root, { projectId, choice: 'Use SQLite' });
      const result = supersedeDecision(root, projectId, old.id, {
        projectId,
        choice: 'Use JSONL instead',
        rationale: 'No native module issues',
      });
      expect(result).not.toBeNull();
      expect(result!.old.status).toBe(DecisionStatuses.SUPERSEDED);
      expect(result!.old.supersededBy).toBe(result!.new.id);
      expect(result!.new.status).toBe(DecisionStatuses.ACTIVE);
      expect(result!.new.alternatives).toContain('Use SQLite');
    });

    it('should retrieve by ID', () => {
      const d = createDecision(root, { projectId, choice: 'Find me' });
      const found = getDecision(root, projectId, d.id);
      expect(found!.choice).toBe('Find me');
    });

    it('should return null for unknown ID', () => {
      expect(getDecision(root, projectId, 'dec_nope')).toBeNull();
    });

    it('should return null when rejecting unknown decision', () => {
      expect(rejectDecision(root, projectId, 'dec_nope', 'reason')).toBeNull();
    });
  });

  // ═══════════ ST2: Tasks ════════════════════════════════

  describe('tasks', () => {
    it('should create a pending task', () => {
      const t = createTask(root, { projectId, description: 'Implement MCP server' });
      expect(t.id).toMatch(/^task_/);
      expect(t.status).toBe(TaskStatuses.PENDING);
      expect(t.description).toBe('Implement MCP server');
      expect(t.completedAt).toBeNull();
    });

    it('should transition to active', () => {
      const t = createTask(root, { projectId, description: 'Start coding' });
      const updated = updateTaskStatus(root, projectId, t.id, TaskStatuses.ACTIVE);
      expect(updated!.status).toBe(TaskStatuses.ACTIVE);
    });

    it('should transition to completed with note and timestamp', () => {
      const t = createTask(root, { projectId, description: 'Finish schema' });
      const updated = updateTaskStatus(root, projectId, t.id, TaskStatuses.COMPLETED, 'All 7 types done');
      expect(updated!.status).toBe(TaskStatuses.COMPLETED);
      expect(updated!.completionNote).toBe('All 7 types done');
      expect(updated!.completedAt).toMatch(/Z$/);
    });

    it('should transition to blocked with reason', () => {
      const t = createTask(root, { projectId, description: 'Deploy to prod' });
      const updated = updateTaskStatus(root, projectId, t.id, TaskStatuses.BLOCKED, 'Waiting for security review');
      expect(updated!.status).toBe(TaskStatuses.BLOCKED);
      expect(updated!.blockedReason).toBe('Waiting for security review');
    });

    it('should filter tasks by status', () => {
      createTask(root, { projectId, description: 'Task A' });
      const b = createTask(root, { projectId, description: 'Task B' });
      createTask(root, { projectId, description: 'Task C' });
      updateTaskStatus(root, projectId, b.id, TaskStatuses.COMPLETED);

      expect(listTasks(root, projectId, TaskStatuses.PENDING)).toHaveLength(2);
      expect(listTasks(root, projectId, TaskStatuses.COMPLETED)).toHaveLength(1);
      expect(listTasks(root, projectId)).toHaveLength(3);
    });

    it('should support dependencies', () => {
      const t1 = createTask(root, { projectId, description: 'Schema' });
      const t2 = createTask(root, { projectId, description: 'Ledger', dependencies: [t1.id] });
      expect(t2.dependencies).toContain(t1.id);
    });

    it('should return null for unknown task', () => {
      expect(getTask(root, projectId, 'task_nope')).toBeNull();
      expect(updateTaskStatus(root, projectId, 'task_nope', TaskStatuses.ACTIVE)).toBeNull();
    });
  });

  // ═══════════ ST3: Attempts ═════════════════════════════

  describe('attempts', () => {
    it('should record a failed attempt with reason', () => {
      const a = recordAttempt(root, {
        projectId,
        approach: 'Use SQLite for primary storage',
        outcome: AttemptOutcomes.FAILURE,
        failureReason: 'Native module linking errors on ARM Macs',
        observations: 'better-sqlite3 requires platform-specific binaries',
      });
      expect(a.id).toMatch(/^att_/);
      expect(a.outcome).toBe(AttemptOutcomes.FAILURE);
      expect(a.failureReason).toContain('linking errors');
      expect(a.observations).toContain('platform-specific');
    });

    it('should record a successful attempt', () => {
      const a = recordAttempt(root, {
        projectId,
        approach: 'Use JSONL for append-only storage',
        outcome: AttemptOutcomes.SUCCESS,
        observations: 'Simple, portable, no dependencies',
      });
      expect(a.outcome).toBe(AttemptOutcomes.SUCCESS);
    });

    it('should record a partial attempt', () => {
      const a = recordAttempt(root, {
        projectId,
        approach: 'Use protobuf for serialization',
        outcome: AttemptOutcomes.PARTIAL,
        observations: 'Works for fixed schema but schema evolution is complex',
      });
      expect(a.outcome).toBe(AttemptOutcomes.PARTIAL);
    });

    it('should record an abandoned attempt', () => {
      const a = recordAttempt(root, {
        projectId,
        approach: 'Build custom binary format',
        outcome: AttemptOutcomes.ABANDONED,
        failureReason: 'Too much effort for Phase 1',
      });
      expect(a.outcome).toBe(AttemptOutcomes.ABANDONED);
    });

    it('should list all attempts', () => {
      recordAttempt(root, { projectId, approach: 'A', outcome: AttemptOutcomes.SUCCESS });
      recordAttempt(root, { projectId, approach: 'B', outcome: AttemptOutcomes.FAILURE, failureReason: 'broke' });
      recordAttempt(root, { projectId, approach: 'C', outcome: AttemptOutcomes.ABANDONED, failureReason: 'nah' });

      expect(listAttempts(root, projectId)).toHaveLength(3);
    });

    it('should filter to failures only', () => {
      recordAttempt(root, { projectId, approach: 'A', outcome: AttemptOutcomes.SUCCESS });
      recordAttempt(root, { projectId, approach: 'B', outcome: AttemptOutcomes.FAILURE, failureReason: 'broke' });
      recordAttempt(root, { projectId, approach: 'C', outcome: AttemptOutcomes.ABANDONED, failureReason: 'nah' });

      const failed = getFailedAttempts(root, projectId);
      expect(failed).toHaveLength(2);
      expect(failed.every((a) => a.outcome === 'failure' || a.outcome === 'abandoned')).toBe(true);
    });

    it('should filter by specific outcome', () => {
      recordAttempt(root, { projectId, approach: 'A', outcome: AttemptOutcomes.SUCCESS });
      recordAttempt(root, { projectId, approach: 'B', outcome: AttemptOutcomes.FAILURE, failureReason: 'x' });

      expect(listAttempts(root, projectId, AttemptOutcomes.SUCCESS)).toHaveLength(1);
    });

    it('should link attempt to related task or decision', () => {
      const task = createTask(root, { projectId, description: 'Try storage options' });
      const a = recordAttempt(root, {
        projectId,
        approach: 'Tried SQLite',
        outcome: AttemptOutcomes.FAILURE,
        failureReason: 'ARM issues',
        relatedId: task.id,
      });
      expect(a.relatedId).toBe(task.id);
    });

    it('should retrieve by ID', () => {
      const a = recordAttempt(root, { projectId, approach: 'Find me', outcome: AttemptOutcomes.SUCCESS });
      const found = getAttempt(root, projectId, a.id);
      expect(found!.approach).toBe('Find me');
    });

    it('should return null for unknown ID', () => {
      expect(getAttempt(root, projectId, 'att_nope')).toBeNull();
    });
  });

  // ═══════════ Cross-tracking ════════════════════════════

  describe('cross-tracking workflow', () => {
    it('should model a realistic decision → attempt → task flow', () => {
      // 1. Decide on storage approach
      const dec = createDecision(root, {
        projectId,
        choice: 'Use SQLite for metadata',
        rationale: 'Fast queries, ACID transactions',
        alternatives: ['JSONL-only', 'LevelDB'],
      });

      // 2. Create task to implement it
      const task = createTask(root, { projectId, description: 'Implement SQLite metadata store' });
      updateTaskStatus(root, projectId, task.id, TaskStatuses.ACTIVE);

      // 3. Attempt fails
      const failedAttempt = recordAttempt(root, {
        projectId,
        approach: 'Use better-sqlite3 directly',
        outcome: AttemptOutcomes.FAILURE,
        failureReason: 'Native module linking fails on ARM Mac CI',
        observations: 'Need to find a pure-JS alternative or accept the dependency',
        relatedId: task.id,
      });

      // 4. Task is blocked
      updateTaskStatus(root, projectId, task.id, TaskStatuses.BLOCKED, 'SQLite native module issues');

      // 5. Decision is superseded
      const result = supersedeDecision(root, projectId, dec.id, {
        projectId,
        choice: 'Use JSONL as primary, SQLite as optional index',
        rationale: 'Avoids hard dependency on native modules',
      });

      // 6. New task to implement the new approach
      const newTask = createTask(root, { projectId, description: 'Implement JSONL + optional SQLite index' });
      updateTaskStatus(root, projectId, newTask.id, TaskStatuses.ACTIVE);

      // 7. Success
      recordAttempt(root, {
        projectId,
        approach: 'JSONL as source of truth, SQLite for search',
        outcome: AttemptOutcomes.SUCCESS,
        observations: 'Clean separation of concerns, ledger stays portable',
        relatedId: newTask.id,
      });

      updateTaskStatus(root, projectId, newTask.id, TaskStatuses.COMPLETED, 'Both stores working');

      // Verify final state
      const decisions = listDecisions(root, projectId, true);
      expect(decisions.filter((d) => d.status === 'active')).toHaveLength(1);
      expect(decisions.filter((d) => d.status === 'superseded')).toHaveLength(1);

      const tasks = listTasks(root, projectId);
      expect(tasks.filter((t) => t.status === 'completed')).toHaveLength(1);
      expect(tasks.filter((t) => t.status === 'blocked')).toHaveLength(1);

      const attempts = listAttempts(root, projectId);
      expect(attempts.filter((a) => a.outcome === 'success')).toHaveLength(1);
      expect(attempts.filter((a) => a.outcome === 'failure')).toHaveLength(1);

      const failed = getFailedAttempts(root, projectId);
      expect(failed).toHaveLength(1);
      expect(failed[0].approach).toContain('better-sqlite3');
    });
  });
});
