import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, setActiveProject,
  startSession, setActiveSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, recordAttempt,
  AttemptOutcomes,
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

describe('continuum capsule export', () => {
  let root: string;
  let outputDir: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-capsule-'));
    outputDir = mkdtempSync(join(tmpdir(), 'continuum-capsule-out-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Capsule CLI Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId }).data!;
    setActiveSession(root, sess.id);

    importTranscript(root, projectId, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'Build a context platform.' },
      { role: 'assistant', content: 'Done setting up the project.' },
      { role: 'user', content: 'The system must preserve events.' },
    ])), 'test');

    const events = openLedger(root, projectId, sess.id).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));
    createDecision(root, { projectId, choice: 'Use JSONL' });
    createTask(root, { projectId, description: 'Build MCP server' });
    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('should export a capsule', () => {
    const output = run(`capsule export -o ${outputDir}`, root);
    expect(output).toContain('Capsule exported');
    expect(output).toContain('events');
    expect(output).toContain('cap_');

    // Find the .ctx directory
    const entries = readdirSync(outputDir);
    const ctxDir = entries.find((e) => e.endsWith('.ctx'));
    expect(ctxDir).toBeDefined();

    const capsulePath = join(outputDir, ctxDir!);
    expect(existsSync(join(capsulePath, 'manifest.json'))).toBe(true);
    expect(existsSync(join(capsulePath, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(capsulePath, 'integrity.json'))).toBe(true);
  });

  it('should verify an exported capsule', () => {
    run(`capsule export -o ${outputDir}`, root);

    const entries = readdirSync(outputDir);
    const ctxDir = entries.find((e) => e.endsWith('.ctx'))!;
    const capsulePath = join(outputDir, ctxDir);

    const output = run(`capsule verify ${capsulePath}`, root);
    expect(output).toContain('verified');
    expect(output).toContain('All');
  });

  it('should detect tampered capsule', () => {
    run(`capsule export -o ${outputDir}`, root);

    const entries = readdirSync(outputDir);
    const ctxDir = entries.find((e) => e.endsWith('.ctx'))!;
    const capsulePath = join(outputDir, ctxDir);

    // Tamper
    writeFileSync(join(capsulePath, 'events.jsonl'), 'TAMPERED', 'utf-8');

    const output = runFail(`capsule verify ${capsulePath}`, root);
    expect(output).toContain('FAILED');
  });

  it('should include notes in export', () => {
    const output = run(`capsule export -o ${outputDir} --notes "Pre-release checkpoint"`, root);
    expect(output).toContain('Pre-release checkpoint');
  });

  it('should show capsule subcommands in help', () => {
    const output = run('capsule --help', root);
    expect(output).toContain('export');
    expect(output).toContain('verify');
    expect(output).toContain('manifest');
    expect(output).toContain('validate');
  });
});
