import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, setActiveProject,
  startSession, setActiveSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, exportCapsule,
  getState, listProjects,
  AttemptOutcomes,
} from '@dhruv-techdev/continuum-core';

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

describe('continuum capsule import', () => {
  let srcRoot: string;
  let destRoot: string;
  let capsuleDir: string;
  let capsulePath: string;

  beforeEach(() => {
    srcRoot = mkdtempSync(join(tmpdir(), 'continuum-cli-imp-src-'));
    destRoot = mkdtempSync(join(tmpdir(), 'continuum-cli-imp-dest-'));
    capsuleDir = mkdtempSync(join(tmpdir(), 'continuum-cli-imp-cap-'));

    // Build source
    initWorkspace(srcRoot);
    const proj = createProject(srcRoot, { title: 'CLI Import Source' }).data!;
    setActiveProject(srcRoot, proj.id);
    const sess = startSession(srcRoot, { projectId: proj.id }).data!;
    setActiveSession(srcRoot, sess.id);

    importTranscript(srcRoot, proj.id, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'Build a context platform.' },
      { role: 'assistant', content: 'Done setting up.' },
      { role: 'user', content: 'Must preserve events.' },
    ])), 'test');

    const events = openLedger(srcRoot, proj.id, sess.id).readAll().events;
    saveWorkingState(srcRoot, proj.id, extractWorkingState(proj.id, events));
    createDecision(srcRoot, { projectId: proj.id, choice: 'Use JSONL' });

    const exported = exportCapsule({ workspaceRoot: srcRoot, projectId: proj.id, outputDir: capsuleDir });
    capsulePath = exported.capsulePath;

    // Init destination
    initWorkspace(destRoot);
  });

  afterEach(() => {
    rmSync(srcRoot, { recursive: true, force: true });
    rmSync(destRoot, { recursive: true, force: true });
    rmSync(capsuleDir, { recursive: true, force: true });
  });

  it('should import a capsule via CLI', () => {
    const output = run(`capsule import ${capsulePath}`, destRoot);
    expect(output).toContain('imported successfully');
    expect(output).toContain('CLI Import Source');
    expect(output).toContain('Events:      3');
    expect(output).toContain('auto-selected');
  });

  it('should auto-select the imported project', () => {
    run(`capsule import ${capsulePath}`, destRoot);
    const state = getState(destRoot);
    expect(state.activeProjectId).toMatch(/^proj_/);
  });

  it('should allow title override', () => {
    const output = run(`capsule import ${capsulePath} -t "Renamed Project"`, destRoot);
    expect(output).toContain('Renamed Project');
  });

  it('should show validation phases', () => {
    const output = run(`capsule import ${capsulePath}`, destRoot);
    expect(output).toContain('Structure');
    expect(output).toContain('Schema');
    expect(output).toContain('Integrity');
    expect(output).toContain('Events');
    expect(output).toContain('Import');
  });

  it('should reject a tampered capsule', () => {
    writeFileSync(join(capsulePath, 'events.jsonl'), 'HACKED\n', 'utf-8');
    const output = runFail(`capsule import ${capsulePath}`, destRoot);
    expect(output).toContain('failed');
  });

  it('should reject nonexistent path', () => {
    const output = runFail('capsule import /no/such/capsule.ctx', destRoot);
    expect(output).toContain('not found');
  });

  it('should allow --skip-integrity', () => {
    // Tamper integrity but skip check
    writeFileSync(join(capsulePath, 'integrity.json'), '{}', 'utf-8');
    const output = run(`capsule import ${capsulePath} --skip-integrity`, destRoot);
    expect(output).toContain('imported successfully');
  });

  it('should show import in help', () => {
    const output = run('capsule --help', destRoot);
    expect(output).toContain('import');
    expect(output).toContain('export');
    expect(output).toContain('verify');
  });

  it('should allow browsing imported history', () => {
    run(`capsule import ${capsulePath}`, destRoot);

    // Sync and search
    run('db sync', destRoot);
    const searchOutput = run('search "context platform"', destRoot);
    expect(searchOutput).toContain('result');
  });
});
