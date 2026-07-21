import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, startSession, listSessions,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, updateTaskStatus, recordAttempt,
  buildContextPackage, buildSingleLayer,
  ContextLayers, ALL_LAYERS,
  estimateTokens, trimToTokenBudget,
  TaskStatuses, AttemptOutcomes,
} from '../src/index';

describe('tokens', () => {
  describe('estimateTokens()', () => {
    it('should estimate ~1 token per 4 chars', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('a'.repeat(100))).toBe(25);
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('trimToTokenBudget()', () => {
    it('should return text unchanged if under budget', () => {
      const text = 'Short text.';
      expect(trimToTokenBudget(text, 1000)).toBe(text);
    });

    it('should trim long text to budget', () => {
      const text = 'x'.repeat(10000);
      const result = trimToTokenBudget(text, 100);
      expect(result.length).toBeLessThan(10000);
      expect(result).toContain('trimmed');
    });

    it('should try to cut at paragraph boundaries', () => {
      const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three which is much longer. ' + 'x'.repeat(500);
      const result = trimToTokenBudget(text, 20);
      expect(result).toContain('trimmed');
    });
  });
});

describe('buildContextPackage()', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-context-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Context Test', description: 'Testing context layers' }).data!;
    projectId = proj.id;
    const sess = startSession(root, { projectId, provider: 'anthropic', model: 'claude-sonnet' }).data!;

    importTranscript(root, projectId, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'I want to build a context continuity platform for AI workflows.' },
      { role: 'assistant', content: 'I have set up a TypeScript monorepo with four packages.' },
      { role: 'user', content: 'The system must never silently drop an event. This is a hard requirement.' },
      { role: 'user', content: 'I decided to use JSONL for the append-only ledger.' },
      { role: 'assistant', content: 'Done. Implemented SHA-256 hash verification for every event.' },
      { role: 'user', content: 'I tried SQLite for the primary store but it failed with ARM linking errors.' },
      { role: 'user', content: 'I am assuming Node.js 18 or higher.' },
      { role: 'user', content: 'Next step is to implement the MCP server.' },
      { role: 'user', content: 'Should we support multiple providers in v1?' },
    ])), 'test');

    const events = openLedger(root, projectId, sess.id).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));

    createDecision(root, { projectId, choice: 'Use JSONL for storage', rationale: 'Simple, portable', alternatives: ['SQLite', 'Protobuf'] });
    const task = createTask(root, { projectId, description: 'Implement event schema' });
    updateTaskStatus(root, projectId, task.id, TaskStatuses.COMPLETED, 'All 7 types done');
    createTask(root, { projectId, description: 'Build MCP server' });
    recordAttempt(root, { projectId, approach: 'SQLite for primary store', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM linking errors', observations: 'Need pure-JS alternative' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: L0 Orientation ─────────────────────────────────

  describe('ST1 — L0 Orientation', () => {
    it('should include project title and description', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L0_ORIENTATION);
      expect(layer.content).toContain('Context Test');
      expect(layer.content).toContain('Testing context layers');
    });

    it('should include session and event counts', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L0_ORIENTATION);
      expect(layer.content).toContain('Sessions:');
      expect(layer.content).toContain('events:');
    });

    it('should include primary objective if available', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L0_ORIENTATION);
      expect(layer.content).toContain('objective');
    });

    it('should be marked as always loaded', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L0_ORIENTATION);
      expect(layer.loadBehavior).toBe('always');
      expect(layer.layer).toBe('L0');
    });
  });

  // ── ST2: L1 Active state ────────────────────────────────

  describe('ST2 — L1 Active State', () => {
    it('should include objectives', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L1_ACTIVE_STATE);
      expect(layer.content).toContain('Objectives');
    });

    it('should include task statuses', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L1_ACTIVE_STATE);
      expect(layer.content).toContain('Build MCP server');
    });

    it('should include completed work', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L1_ACTIVE_STATE);
      expect(layer.content).toContain('Completed');
      expect(layer.content).toContain('event schema');
    });

    it('should include next actions', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L1_ACTIVE_STATE);
      expect(layer.content).toContain('L1');
    });

    it('should be marked as always loaded', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L1_ACTIVE_STATE);
      expect(layer.loadBehavior).toBe('always');
    });
  });

  // ── ST2: L2 Governing context ───────────────────────────

  describe('ST2 — L2 Governing Context', () => {
    it('should include constraints', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L2_GOVERNING);
      expect(layer.content).toContain('Constraints');
    });

    it('should include active decisions with rationale', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L2_GOVERNING);
      expect(layer.content).toContain('JSONL');
      expect(layer.content).toContain('Decisions');
    });

    it('should include failed attempts', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L2_GOVERNING);
      expect(layer.content).toContain('Failed Attempts');
      expect(layer.content).toContain('SQLite');
      expect(layer.content).toContain('ARM');
    });

    it('should be marked as continuation', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L2_GOVERNING);
      expect(layer.loadBehavior).toBe('continuation');
    });
  });

  // ── ST3: L3 Evidence ────────────────────────────────────

  describe('ST3 — L3 Supporting Evidence', () => {
    it('should include recent events with previews', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L3_EVIDENCE);
      expect(layer.content).toContain('L3');
      expect(layer.content).toContain('evt_');
      expect(layer.content).toContain('message');
    });

    it('should filter by focus topic when provided', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L3_EVIDENCE, 'JSONL');
      expect(layer.content).toContain('JSONL');
      expect(layer.content).toContain('Filtered for topic');
    });

    it('should be marked as selected', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L3_EVIDENCE);
      expect(layer.loadBehavior).toBe('selected');
    });
  });

  // ── ST3: L4 Archive ─────────────────────────────────────

  describe('ST3 — L4 Complete Archive', () => {
    it('should include raw event JSON', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L4_ARCHIVE, undefined, 100);
      expect(layer.content).toContain('L4');
      expect(layer.content).toContain('"type"');
      expect(layer.content).toContain('"payload"');
    });

    it('should be marked as on_demand', () => {
      const layer = buildSingleLayer(root, projectId, ContextLayers.L4_ARCHIVE);
      expect(layer.loadBehavior).toBe('on_demand');
    });

    it('should respect maxEvents limit', () => {
      const small = buildSingleLayer(root, projectId, ContextLayers.L4_ARCHIVE, undefined, 2);
      const large = buildSingleLayer(root, projectId, ContextLayers.L4_ARCHIVE, undefined, 100);
      expect(small.tokenEstimate).toBeLessThan(large.tokenEstimate);
    });
  });

  // ── Package assembly ────────────────────────────────────

  describe('context package', () => {
    it('should build default L0+L1+L2 package', () => {
      const pkg = buildContextPackage({ workspaceRoot: root, projectId });
      expect(pkg.includedLayers).toEqual(['L0', 'L1', 'L2']);
      expect(pkg.layers).toHaveLength(3);
      expect(pkg.combined).toContain('L0');
      expect(pkg.combined).toContain('L1');
      expect(pkg.combined).toContain('L2');
      expect(pkg.totalTokens).toBeGreaterThan(0);
    });

    it('should build full L0-L4 package', () => {
      const pkg = buildContextPackage({
        workspaceRoot: root, projectId,
        layers: ALL_LAYERS as unknown as ContextLayer[],
      });
      expect(pkg.includedLayers).toHaveLength(5);
      expect(pkg.combined).toContain('L3');
      expect(pkg.combined).toContain('L4');
    });

    it('should respect token budget', () => {
      const unlimited = buildContextPackage({ workspaceRoot: root, projectId, layers: [...ALL_LAYERS] as ContextLayer[] });
      const limited = buildContextPackage({
        workspaceRoot: root, projectId,
        layers: [...ALL_LAYERS] as ContextLayer[],
        tokenBudget: 200,
      });

      expect(limited.totalTokens).toBeLessThanOrEqual(unlimited.totalTokens);
      expect(limited.excludedLayers.length + limited.includedLayers.length).toBe(5);
    });

    it('should include header with metadata', () => {
      const pkg = buildContextPackage({ workspaceRoot: root, projectId });
      expect(pkg.combined).toContain('Context Transfer Package');
      expect(pkg.combined).toContain('Context Test');
      expect(pkg.combined).toContain('Layers:');
    });

    it('should handle project with no data gracefully', () => {
      const emptyProj = createProject(root, { title: 'Empty' }).data!;
      startSession(root, { projectId: emptyProj.id });

      const pkg = buildContextPackage({ workspaceRoot: root, projectId: emptyProj.id });
      expect(pkg.layers).toHaveLength(3);
      expect(pkg.totalTokens).toBeGreaterThan(0);
    });

    it('should pass focus topic to L3', () => {
      const pkg = buildContextPackage({
        workspaceRoot: root, projectId,
        layers: [ContextLayers.L0_ORIENTATION, ContextLayers.L3_EVIDENCE],
        focusTopic: 'hash verification',
      });
      expect(pkg.combined).toContain('hash verification');
    });
  });

  // ── Session scoping ──────────────────────────────────────

  describe('session-scoped resume', () => {
    let sessionAId: string;
    let sessionBId: string;

    beforeEach(() => {
      const sessions = listSessions(root, projectId);
      sessionAId = sessions[0].id;

      const sessB = startSession(root, { projectId, provider: 'openai', model: 'gpt-4o' }).data!;
      sessionBId = sessB.id;

      importTranscript(root, projectId, sessB.id, parseJSON(JSON.stringify([
        { role: 'user', content: 'Completely unrelated: switch the logging library to pino.' },
        { role: 'assistant', content: 'Done, migrated to pino for structured logs.' },
      ])), 'test');
    });

    it('should scope L0-L2 to just the given session', () => {
      const pkg = buildContextPackage({ workspaceRoot: root, projectId, sessionId: sessionAId });
      expect(pkg.combined).not.toContain('pino');
      expect(pkg.combined).toContain('single session (' + sessionAId + ')');
    });

    it('should not leak the other session\'s state', () => {
      const pkgB = buildContextPackage({ workspaceRoot: root, projectId, sessionId: sessionBId });
      expect(pkgB.combined).not.toContain('JSONL for the append-only ledger');
    });

    it('should throw for an unknown session ID', () => {
      expect(() =>
        buildContextPackage({ workspaceRoot: root, projectId, sessionId: 'sess_nonexistent' }),
      ).toThrow(/not found/);
    });

    it('should include all sessions when sessionId is omitted', () => {
      const pkg = buildContextPackage({ workspaceRoot: root, projectId });
      expect(pkg.combined).not.toContain('**Scope:**');
    });
  });
});
