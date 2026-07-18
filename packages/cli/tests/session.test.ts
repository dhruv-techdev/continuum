import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { initWorkspace, createProject, setActiveProject, getState } from '@continuum/core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

function runFail(args: string, root: string): string {
  try {
    execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return '';
  } catch (err) {
    return (err as { stderr: string }).stderr || (err as { stdout: string }).stdout || '';
  }
}

describe('continuum session', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-sess-'));
    initWorkspace(root);
    const result = createProject(root, { title: 'Session CLI Test' });
    projectId = result.data!.id;
    setActiveProject(root, projectId);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('start', () => {
    it('should start a session and set it active', () => {
      const output = run('session start -p anthropic -m claude-sonnet-4-6', root);
      expect(output).toContain('Session started');
      expect(output).toContain('anthropic');
      expect(output).toContain('claude-sonnet-4-6');

      const state = getState(root);
      expect(state.activeSessionId).toMatch(/^sess_/);
    });

    it('should error when no project is selected', () => {
      setActiveProject(root, null);
      const output = runFail('session start', root);
      expect(output).toContain('No active project');
    });
  });

  describe('list', () => {
    it('should show helpful message when no sessions exist', () => {
      const output = run('session list', root);
      expect(output).toContain('No sessions yet');
    });

    it('should list sessions with active marker', () => {
      run('session start -p openai -m gpt-4', root);
      const output = run('session list', root);
      expect(output).toContain('openai');
      expect(output).toContain('← active');
    });
  });

  describe('close', () => {
    it('should close the active session', () => {
      run('session start', root);
      const output = run('session close', root);
      expect(output).toContain('Session closed');

      const state = getState(root);
      expect(state.activeSessionId).toBeNull();
    });

    it('should close a session by ID', () => {
      run('session start', root);
      const state = getState(root);
      const sessionId = state.activeSessionId!;

      const output = run(`session close ${sessionId}`, root);
      expect(output).toContain('Session closed');
    });

    it('should error when no session is active and no ID given', () => {
      const output = runFail('session close', root);
      expect(output).toContain('No session specified');
    });

    it('should error for nonexistent session ID', () => {
      const output = runFail('session close sess_nonexistent', root);
      expect(output).toContain('not found');
    });
  });
});
