import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  setActiveProject,
  setActiveSession,
  startSession,
  importTranscript,
  parseJSON,
  getState,
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

describe('continuum verify-ledger', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-verify-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Verify Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId, provider: 'test', model: 'test-model' }).data!;
    sessionId = sess.id;
    setActiveSession(root, sessionId);

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Thanks' },
    ]));
    importTranscript(root, projectId, sessionId, parseResult, 'test');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should pass for a clean ledger', () => {
    const output = run('verify-ledger', root);
    expect(output).toContain('PASSED');
    expect(output).toContain('3/3 valid');
    expect(output).toContain('No issues found');
  });

  it('should detect tampered content', () => {
    const ledgerPath = join(root, 'projects', projectId, 'sessions', sessionId, 'events.jsonl');
    let raw = readFileSync(ledgerPath, 'utf-8');
    raw = raw.replace('Hello', 'HACKED');
    writeFileSync(ledgerPath, raw, 'utf-8');

    const output = runFail('verify-ledger', root);
    expect(output).toContain('FAILED');
  });

  it('should work with --session flag', () => {
    const output = run(`verify-ledger --session ${sessionId}`, root);
    expect(output).toContain('PASSED');
  });

  it('should work with --all flag', () => {
    // Create a second session
    const sess2 = startSession(root, { projectId }).data!;
    setActiveSession(root, sess2.id);
    const parseResult = parseJSON(JSON.stringify([{ role: 'user', content: 'second' }]));
    importTranscript(root, projectId, sess2.id, parseResult, 'test');

    const output = run('verify-ledger --all', root);
    expect(output).toContain('2 session(s) verified');
    expect(output).toContain('All passed');
  });

  it('should error when no active session and no flags', () => {
    setActiveSession(root, null);
    const output = runFail('verify-ledger', root);
    expect(output).toContain('No active session');
  });

  it('should show in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('verify-ledger');
  });
});
