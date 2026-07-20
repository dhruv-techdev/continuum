import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, setActiveProject,
  startSession, setActiveSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, recordAttempt,
  openDB, closeDB, recoverWorkspace, ensureFTS,
  AttemptOutcomes,
} from '@continuum/core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('continuum mcp', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-mcp-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'MCP CLI Test' }).data!;
    setActiveProject(root, proj.id);

    const sess = startSession(root, { projectId: proj.id }).data!;
    setActiveSession(root, sess.id);

    importTranscript(root, proj.id, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'Build a context platform.' },
      { role: 'assistant', content: 'Set up the monorepo.' },
      { role: 'user', content: 'Must preserve events.' },
    ])), 'test');

    const events = openLedger(root, proj.id, sess.id).readAll().events;
    saveWorkingState(root, proj.id, extractWorkingState(proj.id, events));
    createDecision(root, { projectId: proj.id, choice: 'Use JSONL' });
    recordAttempt(root, { projectId: proj.id, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM' });

    const db = openDB(root);
    ensureFTS(db);
    recoverWorkspace(db, root);
    closeDB(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('mcp tools', () => {
    it('should list all MCP tools', () => {
      const output = run('mcp tools', root);
      expect(output).toContain('context.resume');
      expect(output).toContain('context.get_state');
      expect(output).toContain('context.search');
      expect(output).toContain('context.get_source');
      expect(output).toContain('context.get_decisions');
      expect(output).toContain('context.get_attempts');
    });
  });

  describe('mcp test', () => {
    it('should test context.resume', () => {
      const output = run('mcp test -t context.resume', root);
      const result = JSON.parse(output);
      expect(result.project.title).toBe('MCP CLI Test');
      expect(result.context.length).toBeGreaterThan(0);
      expect(result.layers).toContain('L0');
    });

    it('should test context.get_state', () => {
      const output = run('mcp test -t context.get_state', root);
      const result = JSON.parse(output);
      expect(result.project_id).toBeDefined();
      expect(result.total_events).toBe(3);
    });

    it('should test context.search', () => {
      const output = run("mcp test -t context.search -a '{\"query\":\"monorepo\"}'", root);
      const result = JSON.parse(output);
      expect(result.result_count).toBeGreaterThanOrEqual(1);
    });

    it('should test context.get_decisions', () => {
      const output = run('mcp test -t context.get_decisions', root);
      const result = JSON.parse(output);
      expect(result.count).toBe(1);
      expect(result.decisions[0].choice).toBe('Use JSONL');
    });

    it('should test context.get_attempts', () => {
      const output = run('mcp test -t context.get_attempts', root);
      const result = JSON.parse(output);
      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    it('should test context.get_attempts with failures_only', () => {
      const output = run("mcp test -t context.get_attempts -a '{\"failures_only\":true}'", root);
      const result = JSON.parse(output);
      expect(result.count).toBe(1);
      expect(result.attempts[0].outcome).toBe('failure');
    });

    it('should error for unknown tool', () => {
      try {
        run('mcp test -t context.nonexistent', root);
        expect.fail('Should have thrown');
      } catch {
        // Expected
      }
    });
  });

  describe('mcp config', () => {
    it('should print MCP configuration JSON', () => {
      const output = run('mcp config', root);
      expect(output).toContain('continuum');
      expect(output).toContain('mcpServers');
    });
  });

  it('should show mcp subcommands in help', () => {
    const output = run('mcp --help', root);
    expect(output).toContain('start');
    expect(output).toContain('tools');
    expect(output).toContain('config');
    expect(output).toContain('test');
  });
});
