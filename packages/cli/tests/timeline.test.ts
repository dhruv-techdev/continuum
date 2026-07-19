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
} from '@continuum/core';

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

describe('continuum timeline and event', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-timeline-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Timeline CLI' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId }).data!;
    sessionId = sess.id;
    setActiveSession(root, sessionId);

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'Set up the monorepo structure.' },
      { role: 'assistant', content: 'Done, created packages with pnpm workspaces.' },
      { role: 'user', content: 'Now implement the event schema.' },
      { role: 'assistant', content: 'Implemented seven event types with validation.' },
      { role: 'user', content: 'Add full-text search capability.' },
    ]));
    importTranscript(root, projectId, sessionId, parseResult, 'test');
    run('db sync', root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('timeline', () => {
    it('should show all events chronologically', () => {
      const output = run('timeline', root);
      expect(output).toContain('5 event(s)');
      expect(output).toContain('message');
      expect(output).toContain('monorepo');
    });

    it('should filter by event type', () => {
      const output = run('timeline -t message', root);
      expect(output).toContain('message');
    });

    it('should paginate with --limit and --offset', () => {
      const page1 = run('timeline -n 2', root);
      expect(page1).toContain('showing 2 of 5');
      expect(page1).toContain('--offset 2');

      const page2 = run('timeline -n 2 --offset 2', root);
      expect(page2).toContain('event(s)');
    });

    it('should support --desc for newest first', () => {
      const output = run('timeline --desc -n 2', root);
      expect(output).toContain('event(s)');
    });

    it('should show verbose details', () => {
      const output = run('timeline --verbose -n 1', root);
      expect(output).toContain('ID:');
      expect(output).toContain('Session:');
      expect(output).toContain('Hash:');
    });

    it('should show empty message for no matches', () => {
      const output = run('timeline -t artifact', root);
      expect(output).toContain('No events');
    });
  });

  describe('event show', () => {
    it('should show full event details by ID', () => {
      // Get an event ID from the timeline
      const tlOutput = run('timeline --verbose -n 1', root);
      const idMatch = tlOutput.match(/evt_[0-9a-f-]+/);
      expect(idMatch).not.toBeNull();

      const output = run(`event show ${idMatch![0]}`, root);
      expect(output).toContain(idMatch![0]);
      expect(output).toContain('Type:');
      expect(output).toContain('Payload:');
    });

    it('should output JSON with --json', () => {
      const tlOutput = run('timeline --verbose -n 1', root);
      const idMatch = tlOutput.match(/evt_[0-9a-f-]+/);

      const output = run(`event show ${idMatch![0]} --json`, root);
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe(idMatch![0]);
      expect(parsed.payload).toBeDefined();
    });

    it('should error for nonexistent event', () => {
      const output = runFail('event show evt_nonexistent', root);
      expect(output).toContain('not found');
    });
  });

  it('should show timeline and event in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('timeline');
    expect(output).toContain('event');
  });
});
