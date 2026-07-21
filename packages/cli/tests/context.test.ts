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
  createDecision, createTask, recordAttempt,
  AttemptOutcomes,
} from '@dhruv-techdev/continuum-core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('continuum context', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-context-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Context CLI Test' }).data!;
    setActiveProject(root, proj.id);

    const sess = startSession(root, { projectId: proj.id }).data!;
    setActiveSession(root, sess.id);

    importTranscript(root, proj.id, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'I want to build a context platform.' },
      { role: 'assistant', content: 'Set up the monorepo.' },
      { role: 'user', content: 'The system must preserve all events.' },
      { role: 'user', content: 'I decided to use JSONL.' },
      { role: 'user', content: 'I tried SQLite but it failed.' },
    ])), 'test');

    const events = openLedger(root, proj.id, sess.id).readAll().events;
    saveWorkingState(root, proj.id, extractWorkingState(proj.id, events));
    createDecision(root, { projectId: proj.id, choice: 'JSONL storage' });
    createTask(root, { projectId: proj.id, description: 'Build MCP' });
    recordAttempt(root, { projectId: proj.id, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM issues' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('context package', () => {
    it('should generate default L0+L1+L2 package', () => {
      const output = run('context package', root);
      expect(output).toContain('Context Package');
      expect(output).toContain('L0');
      expect(output).toContain('L1');
      expect(output).toContain('L2');
      expect(output).toContain('tokens');
    });

    it('should generate full L0-L4 package', () => {
      const output = run('context package -l L0,L1,L2,L3,L4', root);
      expect(output).toContain('L3');
      expect(output).toContain('L4');
    });

    it('should respect --budget', () => {
      const output = run('context package -b 200', root);
      expect(output).toContain('Budget:');
    });

    it('should output raw with --raw', () => {
      const output = run('context package --raw', root);
      expect(output).toContain('Context Transfer Package');
      expect(output).not.toContain('Context Package:'); // No header chrome
    });

    it('should focus L3 with --focus', () => {
      const output = run('context package -l L0,L3 --focus JSONL', root);
      expect(output).toContain('JSONL');
    });
  });

  describe('context layer', () => {
    it('should generate a single L0 layer', () => {
      const output = run('context layer L0', root);
      expect(output).toContain('L0');
      expect(output).toContain('Orientation');
    });

    it('should generate a single L3 layer', () => {
      const output = run('context layer L3', root);
      expect(output).toContain('L3');
      expect(output).toContain('Evidence');
    });

    it('should generate a single L4 layer', () => {
      const output = run('context layer L4', root);
      expect(output).toContain('L4');
      expect(output).toContain('Archive');
    });

    it('should output raw with --raw', () => {
      const output = run('context layer L0 --raw', root);
      expect(output).toContain('L0');
      expect(output).not.toContain('tokens');
    });

    it('should reject invalid layer', () => {
      try {
        run('context layer L9', root);
        expect.fail('Should have thrown');
      } catch {
        // Expected
      }
    });
  });

  describe('context resume', () => {
    it('should generate the standard continuation package', () => {
      const output = run('context resume', root);
      expect(output).toContain('Resume Package');
      expect(output).toContain('L0, L1, L2');
    });

    it('should output raw with --raw', () => {
      const output = run('context resume --raw', root);
      expect(output).toContain('Context Transfer Package');
    });
  });

  it('should show context subcommands in help', () => {
    const output = run('context --help', root);
    expect(output).toContain('package');
    expect(output).toContain('layer');
    expect(output).toContain('resume');
  });
});
