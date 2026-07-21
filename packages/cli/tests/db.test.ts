import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  setActiveProject,
  startSession,
  setActiveSession,
  importTranscript,
  parseJSON,
  dbPath,
} from '@dhruv-techdev/continuum-core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('continuum db', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-db-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'DB CLI Test' }).data!;
    setActiveProject(root, proj.id);

    const sess = startSession(root, { projectId: proj.id }).data!;
    setActiveSession(root, sess.id);

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]));
    importTranscript(root, proj.id, sess.id, parseResult, 'test');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('db sync', () => {
    it('should create and populate the database', () => {
      const output = run('db sync', root);
      expect(output).toContain('Sync complete');
      expect(output).toContain('Projects:   1');
      expect(output).toContain('Sessions:   1');
      expect(output).toContain('Events:     2');
      expect(existsSync(dbPath(root))).toBe(true);
    });

    it('should be idempotent', () => {
      run('db sync', root);
      const output = run('db sync', root);
      expect(output).toContain('Events:     0');
    });
  });

  describe('db status', () => {
    it('should report no database before sync', () => {
      const output = run('db status', root);
      expect(output).toContain('Exists:   no');
    });

    it('should show table stats after sync', () => {
      run('db sync', root);
      const output = run('db status', root);
      expect(output).toContain('Exists:   yes');
      expect(output).toContain('projects');
      expect(output).toContain('events');
    });
  });

  describe('db reset', () => {
    it('should rebuild the database from scratch', () => {
      run('db sync', root);
      const output = run('db reset', root);
      expect(output).toContain('rebuilt');
      expect(output).toContain('Events:     2');
    });
  });

  it('should show db subcommands in help', () => {
    const output = run('db --help', root);
    expect(output).toContain('sync');
    expect(output).toContain('status');
    expect(output).toContain('reset');
  });
});
