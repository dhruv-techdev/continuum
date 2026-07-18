import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  setActiveProject,
  startSession,
  setActiveSession,
  getSession,
  openLedger,
  createEvent,
  EventTypes,
  MessageRoles,
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

describe('continuum capture', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-capture-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Capture CLI Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId, provider: 'cli', model: 'manual' }).data!;
    sessionId = sess.id;
    setActiveSession(root, sessionId);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── capture message ─────────────────────────────────────

  describe('capture message', () => {
    it('should capture a user message', () => {
      const output = run('capture message -r user -c "Hello world"', root);
      expect(output).toContain('Captured 1 event');

      const ledger = openLedger(root, projectId, sessionId);
      const { events } = ledger.readAll();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('message');
    });

    it('should capture an assistant message', () => {
      const output = run('capture message -r assistant -c "I can help with that"', root);
      expect(output).toContain('Captured 1 event');
    });

    it('should capture a system message', () => {
      const output = run('capture message -r system -c "You are helpful"', root);
      expect(output).toContain('Captured 1 event');
    });

    it('should reject invalid role', () => {
      const output = runFail('capture message -r admin -c "test"', root);
      expect(output).toContain('Invalid role');
    });

    it('should update session event count', () => {
      run('capture message -r user -c "one"', root);
      run('capture message -r assistant -c "two"', root);

      const session = getSession(root, projectId, sessionId);
      expect(session!.eventCount).toBe(2);
    });
  });

  // ── capture note ────────────────────────────────────────

  describe('capture note', () => {
    it('should capture a quick note as user message', () => {
      const output = run('capture note "Remember to add error handling"', root);
      expect(output).toContain('Captured 1 event');

      const ledger = openLedger(root, projectId, sessionId);
      const { events } = ledger.readAll();
      expect(events[0].type).toBe('message');
    });
  });

  // ── capture command ─────────────────────────────────────

  describe('capture command', () => {
    it('should capture a command event', () => {
      const output = run('capture command -c "npm test"', root);
      expect(output).toContain('Captured');

      const ledger = openLedger(root, projectId, sessionId);
      const { events } = ledger.readAll();
      expect(events[0].type).toBe('command');
    });

    it('should capture command with output', () => {
      const output = run('capture command -c "npm test" --stdout "PASS" --exit-code 0', root);
      expect(output).toContain('Captured 2 event');

      const ledger = openLedger(root, projectId, sessionId);
      const { events } = ledger.readAll();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('command');
      expect(events[1].type).toBe('command_output');
    });
  });

  // ── capture file (ST1) ──────────────────────────────────

  describe('capture file', () => {
    it('should ingest events from a JSONL file', () => {
      const e0 = createEvent({
        type: EventTypes.MESSAGE, projectId, sessionId,
        sequence: 0, source: 'file', timestamp: '2025-01-01T00:00:00.000Z',
        payload: { role: MessageRoles.USER, content: 'from file' },
      });

      const filePath = join(root, 'events.jsonl');
      writeFileSync(filePath, JSON.stringify(e0), 'utf-8');

      const output = run(`capture file ${filePath}`, root);
      expect(output).toContain('Captured 1 event');
    });

    it('should report errors for invalid file', () => {
      const filePath = join(root, 'bad.jsonl');
      writeFileSync(filePath, '{ broken json', 'utf-8');

      const output = runFail(`capture file ${filePath}`, root);
      expect(output).toContain('Parse errs');
    });

    it('should error for nonexistent file', () => {
      const output = runFail('capture file /no/such/file.jsonl', root);
      expect(output).toContain('not found');
    });
  });

  // ── capture stdin (ST1) ─────────────────────────────────

  describe('capture stdin', () => {
    it('should ingest events piped via stdin', () => {
      const e0 = createEvent({
        type: EventTypes.MESSAGE, projectId, sessionId,
        sequence: 0, source: 'stdin', timestamp: '2025-01-01T00:00:00.000Z',
        payload: { role: MessageRoles.USER, content: 'piped in' },
      });

      const output = execSync(
        `echo '${JSON.stringify(e0)}' | ${CLI} capture stdin --root ${root}`,
        { encoding: 'utf-8' },
      );
      expect(output).toContain('Captured 1 event');
    });
  });

  // ── ST2: Auto-start session ─────────────────────────────

  describe('auto-start session', () => {
    it('should auto-start a session when none is active', () => {
      setActiveSession(root, null);

      const output = run('capture note "auto-session test"', root);
      expect(output).toContain('Auto-started session');
      expect(output).toContain('Captured 1 event');
    });
  });

  // ── ST2: project/session flags ──────────────────────────

  describe('project/session selection', () => {
    it('should error when no project is active and none specified', () => {
      setActiveProject(root, null);
      const output = runFail('capture note "orphan"', root);
      expect(output).toContain('No active project');
    });
  });

  // ── --help ──────────────────────────────────────────────

  it('should show capture subcommands in help', () => {
    const output = run('capture --help', root);
    expect(output).toContain('message');
    expect(output).toContain('note');
    expect(output).toContain('command');
    expect(output).toContain('file');
    expect(output).toContain('stdin');
  });
});
