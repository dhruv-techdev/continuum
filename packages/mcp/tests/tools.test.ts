import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession,
  setActiveProject, setActiveSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt, updateTaskStatus,
  openDB, closeDB, recoverWorkspace, ensureFTS,
  AttemptOutcomes, TaskStatuses,
} from '@continuum/core';
import { ALL_TOOLS } from '../src/tools';

function callTool(name: string, args: Record<string, unknown>, root: string): unknown {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool.handler(args, root);
}

describe('MCP tools', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-mcp-test-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'MCP Test Project', description: 'Testing MCP tools' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId, provider: 'anthropic', model: 'claude-sonnet' }).data!;
    sessionId = sess.id;
    setActiveSession(root, sessionId);

    importTranscript(root, projectId, sessionId, parseJSON(JSON.stringify([
      { role: 'user', content: 'I want to build a context continuity platform for AI.' },
      { role: 'assistant', content: 'I have set up a TypeScript monorepo with pnpm workspaces.' },
      { role: 'user', content: 'The system must preserve all events without modification.' },
      { role: 'user', content: 'I decided to use JSONL for the append-only ledger format.' },
      { role: 'user', content: 'I tried SQLite but it failed with native module linking errors.' },
      { role: 'user', content: 'Next step is to implement the MCP server.' },
      { role: 'user', content: 'Should we support multiple concurrent sessions per project?' },
    ])), 'test');

    const events = openLedger(root, projectId, sessionId).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));

    createDecision(root, { projectId, choice: 'Use JSONL for storage', rationale: 'Simple and portable', alternatives: ['SQLite', 'Protobuf'] });
    const task = createTask(root, { projectId, description: 'Implement event schema' });
    updateTaskStatus(root, projectId, task.id, TaskStatuses.COMPLETED, 'All 7 types done');
    createTask(root, { projectId, description: 'Build MCP server' });
    recordAttempt(root, { projectId, approach: 'SQLite for primary store', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM linking errors', observations: 'Need pure JS alternative' });
    recordAttempt(root, { projectId, approach: 'JSONL as source of truth', outcome: AttemptOutcomes.SUCCESS, observations: 'Simple and portable' });

    // Sync DB for search
    const db = openDB(root);
    ensureFTS(db);
    recoverWorkspace(db, root);
    closeDB(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should expose all 6 tools', () => {
    expect(ALL_TOOLS).toHaveLength(6);
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toContain('context.resume');
    expect(names).toContain('context.get_state');
    expect(names).toContain('context.search');
    expect(names).toContain('context.get_source');
    expect(names).toContain('context.get_decisions');
    expect(names).toContain('context.get_attempts');
  });

  // ── ST2: context.resume ─────────────────────────────────

  describe('context.resume', () => {
    it('should return a bootstrap context package', () => {
      const result = callTool('context.resume', {}, root) as Record<string, unknown>;
      expect(result.project).toHaveProperty('title', 'MCP Test Project');
      expect(result.context).toBeDefined();
      expect((result.context as string).length).toBeGreaterThan(100);
      expect(result.layers).toContain('L0');
      expect(result.layers).toContain('L1');
      expect(result.layers).toContain('L2');
      expect(result.tokens).toBeGreaterThan(0);
    });

    it('should respect token budget', () => {
      const unlimited = callTool('context.resume', {}, root) as Record<string, unknown>;
      const limited = callTool('context.resume', { token_budget: 200 }, root) as Record<string, unknown>;
      expect((limited.tokens as number)).toBeLessThanOrEqual((unlimited.tokens as number));
    });

    it('should accept explicit project_id', () => {
      const result = callTool('context.resume', { project_id: projectId }, root) as Record<string, unknown>;
      expect((result.project as Record<string, unknown>).id).toBe(projectId);
    });

    it('should error for nonexistent project', () => {
      const result = callTool('context.resume', { project_id: 'proj_nope' }, root) as Record<string, unknown>;
      expect(result.error).toBeDefined();
    });
  });

  // ── ST2: context.get_state ──────────────────────────────

  describe('context.get_state', () => {
    it('should return structured project state', () => {
      const result = callTool('context.get_state', {}, root) as Record<string, unknown>;
      expect(result.project_id).toBe(projectId);
      expect(result.total_events).toBe(7);
      expect(Array.isArray(result.objectives)).toBe(true);
      expect(Array.isArray(result.constraints)).toBe(true);
      expect(Array.isArray(result.next_actions)).toBe(true);
      expect(result.tasks).toBeDefined();
    });

    it('should include task breakdown', () => {
      const result = callTool('context.get_state', {}, root) as Record<string, unknown>;
      const tasks = result.tasks as Record<string, unknown>;
      expect(tasks.completed_count).toBe(1);
      expect(Array.isArray(tasks.pending)).toBe(true);
    });

    it('should include source event IDs in statements', () => {
      const result = callTool('context.get_state', {}, root) as Record<string, unknown>;
      const objectives = result.objectives as Array<{ sources: string[] }>;
      if (objectives.length > 0) {
        expect(objectives[0].sources.length).toBeGreaterThanOrEqual(1);
        expect(objectives[0].sources[0]).toMatch(/^evt_/);
      }
    });
  });

  // ── ST2: context.search ─────────────────────────────────

  describe('context.search', () => {
    it('should find events matching a query', () => {
      const result = callTool('context.search', { query: 'monorepo' }, root) as Record<string, unknown>;
      expect(result.result_count).toBeGreaterThanOrEqual(1);
      const results = result.results as Array<Record<string, unknown>>;
      expect(results[0].event_id).toMatch(/^evt_/);
      expect(results[0].type).toBeDefined();
      expect(results[0].excerpt).toBeDefined();
    });

    it('should filter by type', () => {
      const result = callTool('context.search', { query: 'JSONL', type: 'message' }, root) as Record<string, unknown>;
      const results = result.results as Array<Record<string, unknown>>;
      for (const r of results) {
        expect(r.type).toBe('message');
      }
    });

    it('should respect limit', () => {
      const result = callTool('context.search', { query: 'the', limit: 2 }, root) as Record<string, unknown>;
      expect((result.results as unknown[]).length).toBeLessThanOrEqual(2);
    });

    it('should error on empty query', () => {
      const result = callTool('context.search', { query: '' }, root) as Record<string, unknown>;
      expect(result.error).toBeDefined();
    });

    it('should return empty for non-matching query', () => {
      const result = callTool('context.search', { query: 'kubernetes deployment nginx' }, root) as Record<string, unknown>;
      expect(result.result_count).toBe(0);
    });
  });

  // ── ST3: context.get_source ─────────────────────────────

  describe('context.get_source', () => {
    it('should retrieve events by ID', () => {
      const events = openLedger(root, projectId, sessionId).readAll().events;
      const targetId = events[0].id;

      const result = callTool('context.get_source', { event_ids: [targetId] }, root) as Record<string, unknown>;
      expect(result.total_found).toBe(1);

      const found = result.found as Array<Record<string, unknown>>;
      expect(found[0].id).toBe(targetId);
      expect(found[0].payload).toBeDefined();
    });

    it('should retrieve multiple events', () => {
      const events = openLedger(root, projectId, sessionId).readAll().events;
      const ids = [events[0].id, events[1].id, events[2].id];

      const result = callTool('context.get_source', { event_ids: ids }, root) as Record<string, unknown>;
      expect(result.total_found).toBe(3);
    });

    it('should report missing IDs', () => {
      const result = callTool('context.get_source', { event_ids: ['evt_nonexistent'] }, root) as Record<string, unknown>;
      expect(result.total_found).toBe(0);
      expect((result.missing as string[]).length).toBe(1);
    });

    it('should handle mix of found and missing', () => {
      const events = openLedger(root, projectId, sessionId).readAll().events;
      const result = callTool('context.get_source', { event_ids: [events[0].id, 'evt_nope'] }, root) as Record<string, unknown>;
      expect(result.total_found).toBe(1);
      expect((result.missing as string[])).toContain('evt_nope');
    });

    it('should error when no IDs provided', () => {
      const result = callTool('context.get_source', { event_ids: [] }, root) as Record<string, unknown>;
      expect(result.error).toBeDefined();
    });
  });

  // ── ST3: context.get_decisions ──────────────────────────

  describe('context.get_decisions', () => {
    it('should return active decisions', () => {
      const result = callTool('context.get_decisions', {}, root) as Record<string, unknown>;
      expect(result.count).toBe(1);

      const decisions = result.decisions as Array<Record<string, unknown>>;
      expect(decisions[0].choice).toBe('Use JSONL for storage');
      expect(decisions[0].rationale).toBe('Simple and portable');
      expect(decisions[0].alternatives).toContain('SQLite');
      expect(decisions[0].status).toBe('active');
    });

    it('should include inactive when requested', () => {
      const { rejectDecision, listDecisions: ld } = require('@continuum/core');
      const decs = ld(root, projectId, true);
      if (decs.length > 0) {
        rejectDecision(root, projectId, decs[0].id, 'Testing');
      }

      const result = callTool('context.get_decisions', { include_inactive: true }, root) as Record<string, unknown>;
      expect(result.count).toBeGreaterThanOrEqual(1);
    });
  });

  // ── ST3: context.get_attempts ───────────────────────────

  describe('context.get_attempts', () => {
    it('should return all attempts', () => {
      const result = callTool('context.get_attempts', {}, root) as Record<string, unknown>;
      expect(result.count).toBe(2);

      const attempts = result.attempts as Array<Record<string, unknown>>;
      expect(attempts.some((a) => a.outcome === 'failure')).toBe(true);
      expect(attempts.some((a) => a.outcome === 'success')).toBe(true);
    });

    it('should filter to failures only', () => {
      const result = callTool('context.get_attempts', { failures_only: true }, root) as Record<string, unknown>;
      expect(result.count).toBe(1);

      const attempts = result.attempts as Array<Record<string, unknown>>;
      expect(attempts[0].outcome).toBe('failure');
      expect(attempts[0].failure_reason).toContain('ARM');
      expect(attempts[0].observations).toContain('pure JS');
    });

    it('should include all attempt fields', () => {
      const result = callTool('context.get_attempts', {}, root) as Record<string, unknown>;
      const attempts = result.attempts as Array<Record<string, unknown>>;
      const first = attempts[0];

      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('approach');
      expect(first).toHaveProperty('outcome');
      expect(first).toHaveProperty('failure_reason');
      expect(first).toHaveProperty('observations');
      expect(first).toHaveProperty('created_at');
    });
  });

  // ── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('should return error for all tools when no project is active', () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), 'continuum-mcp-empty-'));
      initWorkspace(emptyRoot);

      for (const tool of ALL_TOOLS) {
        const minArgs: Record<string, unknown> = {};
        if (tool.name === 'context.search') minArgs.query = 'test';
        if (tool.name === 'context.get_source') minArgs.event_ids = ['evt_x'];

        const result = tool.handler(minArgs, emptyRoot) as Record<string, unknown>;
        expect(result.error).toBeDefined();
      }

      rmSync(emptyRoot, { recursive: true, force: true });
    });
  });
});
