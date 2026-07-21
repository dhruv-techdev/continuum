import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
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

describe('continuum search', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-search-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Search CLI Test' }).data!;
    setActiveProject(root, proj.id);

    const sess = startSession(root, { projectId: proj.id }).data!;
    setActiveSession(root, sess.id);

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'I want to build a context continuity platform for AI workflows.' },
      { role: 'assistant', content: 'I have set up a TypeScript monorepo with pnpm workspaces.' },
      { role: 'user', content: 'The system must never silently drop an event.' },
      { role: 'user', content: 'I decided to use JSONL for the append-only ledger format.' },
      { role: 'assistant', content: 'Done. Implemented SHA-256 hash verification for every event.' },
      { role: 'user', content: 'I tried SQLite but it failed with native module linking errors on ARM.' },
    ]));
    importTranscript(root, proj.id, sess.id, parseResult, 'test');

    // Sync to DB so search works
    run('db sync', root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should find events matching a keyword', () => {
    const output = run('search monorepo', root);
    expect(output).toContain('monorepo');
    expect(output).toContain('result(s)');
    expect(output).toContain('evt_');
  });

  it('should find events matching multiple keywords', () => {
    const output = run('search "SHA-256 hash"', root);
    expect(output).toContain('SHA-256');
  });

  it('should show no results message for non-matching query', () => {
    const output = run('search "kubernetes deployment"', root);
    expect(output).toContain('No results');
  });

  it('should filter by event type', () => {
    const output = run('search JSONL --type message', root);
    expect(output).toContain('message');
  });

  it('should respect --limit', () => {
    const output = run('search the -n 2', root);
    // Should have at most 2 results
    const matches = output.match(/\d+\./g);
    expect(matches!.length).toBeLessThanOrEqual(2);
  });

  it('should show verbose content with --verbose', () => {
    const output = run('search JSONL --verbose', root);
    expect(output).toContain('Content:');
  });

  it('should show excerpts with highlighting markers', () => {
    const output = run('search "event"', root);
    expect(output).toContain('>>>');
  });

  it('should show search in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('search');
  });

  it('should auto-sync if no events are indexed', () => {
    // Reset DB then search — should auto-sync
    run('db reset', root);
    const output = run('search monorepo', root);
    expect(output).toContain('monorepo');
  });
});
