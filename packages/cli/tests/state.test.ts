import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
} from '@dhruv-techdev/continuum-core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('continuum state', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-state-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'State CLI Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId }).data!;
    setActiveSession(root, sess.id);

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'I want to build a context continuity platform for AI workflows.' },
      { role: 'assistant', content: 'I have set up the project with a monorepo structure using pnpm workspaces.' },
      { role: 'user', content: 'The system must never silently drop an event. This is a hard requirement.' },
      { role: 'user', content: "Let's use JSONL for the append-only event ledger." },
      { role: 'user', content: 'I tried sqlite but it failed with linking issues on ARM.' },
      { role: 'user', content: 'Next step is to implement the MCP server integration.' },
      { role: 'user', content: 'Should we support multiple concurrent sessions per project?' },
    ]));
    importTranscript(root, projectId, sess.id, parseResult, 'test');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('state show', () => {
    it('should display extracted state categories', () => {
      const output = run('state show', root);
      expect(output).toContain('Working State');
      expect(output).toContain('Objectives');
    });

    it('should show provenance links', () => {
      const output = run('state show --provenance', root);
      // Should contain truncated event IDs
      expect(output).toContain('evt_');
    });

    it('should support --refresh', () => {
      run('state show', root); // caches
      const output = run('state show --refresh', root);
      expect(output).toContain('Working State');
    });
  });

  describe('state bootstrap', () => {
    it('should generate a full bootstrap context', () => {
      const output = run('state bootstrap', root);
      expect(output).toContain('L0');
      expect(output).toContain('L1');
      expect(output).toContain('L2');
      expect(output).toContain('State CLI Test');
      expect(output).toContain('Continuum');
    });

    it('should include objectives in bootstrap', () => {
      const output = run('state bootstrap', root);
      expect(output).toContain('Objectives');
    });

    it('should include constraints in bootstrap', () => {
      const output = run('state bootstrap', root);
      expect(output).toContain('Constraints');
    });

    it('should include decisions in bootstrap', () => {
      const output = run('state bootstrap', root);
      expect(output).toContain('Decisions');
    });
  });

  it('should show state and bootstrap in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('state');
  });
});
