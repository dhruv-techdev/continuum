import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace, createProject, setActiveProject,
  startSession, setActiveSession,
  importTranscript, parseJSON,
  extractWorkingState, saveWorkingState, openLedger,
  createDecision, createTask, updateTaskStatus, recordAttempt,
  generateChecks, scoreChecks, buildReport, saveReport,
  loadDecisions, listTasks, listAttempts,
  TaskStatuses, AttemptOutcomes,
} from '@dhruv-techdev/continuum-core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('continuum dashboard', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-dash-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Dashboard CLI Test', description: 'Full dashboard' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId }).data!;
    setActiveSession(root, sess.id);

    importTranscript(root, projectId, sess.id, parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a platform.' },
      { role: 'assistant', content: 'Set up the monorepo.' },
      { role: 'user', content: 'Must preserve events.' },
      { role: 'user', content: 'I decided to use JSONL.' },
      { role: 'user', content: 'Next step is MCP.' },
    ])), 'test');

    const events = openLedger(root, projectId, sess.id).readAll().events;
    saveWorkingState(root, projectId, extractWorkingState(projectId, events));

    createDecision(root, { projectId, choice: 'Use JSONL' });
    const t = createTask(root, { projectId, description: 'Build schema' });
    updateTaskStatus(root, projectId, t.id, TaskStatuses.COMPLETED);
    createTask(root, { projectId, description: 'Build MCP' });
    recordAttempt(root, { projectId, approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM' });

    // Verification
    const state = extractWorkingState(projectId, events);
    const checks = generateChecks({ state, decisions: loadDecisions(root, projectId), tasks: listTasks(root, projectId), attempts: listAttempts(root, projectId) });
    const answers = new Map<string, string>();
    for (const c of checks) answers.set(c.id, c.expectedAnswer);
    scoreChecks(checks, answers);
    saveReport(root, projectId, buildReport(projectId, checks));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should display a full dashboard', () => {
    const output = run('dashboard', root);

    // ST1: Overview
    expect(output).toContain('Dashboard CLI Test');
    expect(output).toContain('Sessions:');
    expect(output).toContain('Events:');
    expect(output).toContain('message');

    // ST2: State
    expect(output).toContain('Working State');
    expect(output).toContain('Tasks:');
    expect(output).toContain('Decisions:');
    expect(output).toContain('Use JSONL');

    // ST3: Verification
    expect(output).toContain('Verification');
    expect(output).toContain('PASSED');
  });

  it('should show event type chart', () => {
    const output = run('dashboard', root);
    expect(output).toContain('█');
    expect(output).toContain('message');
  });

  it('should show failed attempts', () => {
    const output = run('dashboard', root);
    expect(output).toContain('SQLite');
    expect(output).toContain('ARM');
  });

  it('should show verification scores', () => {
    const output = run('dashboard', root);
    expect(output).toContain('Overall:');
    expect(output).toContain('Correctness:');
    expect(output).toContain('Completeness:');
  });

  it('should output JSON with --json', () => {
    const output = run('dashboard --json', root);
    const parsed = JSON.parse(output);

    expect(parsed.project.title).toBe('Dashboard CLI Test');
    expect(parsed.events.total).toBe(5);
    expect(parsed.tasks.total).toBeGreaterThanOrEqual(2);
    expect(parsed.verification.latestReport).not.toBeNull();
  });

  it('should show helpful commands', () => {
    const output = run('dashboard', root);
    expect(output).toContain('continuum state show');
    expect(output).toContain('continuum capsule export');
    expect(output).toContain('continuum search');
  });

  it('should show dashboard in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('dashboard');
  });
});
