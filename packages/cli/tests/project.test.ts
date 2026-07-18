import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { initWorkspace, getState } from '@continuum/core';

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

describe('continuum project', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-proj-'));
    initWorkspace(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a project and auto-select it', () => {
      const output = run('project create -t "Test Project"', root);
      expect(output).toContain('Project created');
      expect(output).toContain('Test Project');
      expect(output).toContain('auto-selected');

      const state = getState(root);
      expect(state.activeProjectId).toMatch(/^proj_/);
    });

    it('should create a project with description', () => {
      const output = run('project create -t "Described" -d "A test description"', root);
      expect(output).toContain('A test description');
    });
  });

  describe('list', () => {
    it('should show helpful message when no projects exist', () => {
      const output = run('project list', root);
      expect(output).toContain('No projects yet');
    });

    it('should list created projects with active marker', () => {
      run('project create -t "Alpha"', root);
      run('project create -t "Beta"', root);

      const output = run('project list', root);
      expect(output).toContain('Alpha');
      expect(output).toContain('Beta');
      expect(output).toContain('← active');
    });
  });

  describe('select', () => {
    it('should select an existing project', () => {
      run('project create -t "Selectable"', root);
      const state = getState(root);
      const projectId = state.activeProjectId!;

      // Create another project (which auto-selects itself)
      run('project create -t "Other"', root);

      // Now re-select the first
      const output = run(`project select ${projectId}`, root);
      expect(output).toContain('Selectable');

      const newState = getState(root);
      expect(newState.activeProjectId).toBe(projectId);
    });

    it('should error for nonexistent project', () => {
      const output = runFail('project select proj_nonexistent', root);
      expect(output).toContain('not found');
    });
  });
});
