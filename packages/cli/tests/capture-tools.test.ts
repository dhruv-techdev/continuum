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
  openLedger,
  correlateEvents,
} from '@continuum/core';
import type { ToolCallEvent, ToolResultEvent, CommandEvent, CommandOutputEvent } from '@continuum/core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('capture tool-call and tool-result', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-tools-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Tool Capture Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId }).data!;
    sessionId = sess.id;
    setActiveSession(root, sessionId);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should capture a tool call with auto-generated callId', () => {
    const output = run('capture tool-call -n web_search -i \'{"query":"test"}\'', root);
    expect(output).toContain('Tool call captured');
    expect(output).toContain('call_');
    expect(output).toContain('web_search');

    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();
    expect(events[0].type).toBe('tool_call');
    expect((events[0] as ToolCallEvent).payload.callId).toMatch(/^call_/);
  });

  it('should capture a tool call with explicit callId', () => {
    const output = run('capture tool-call -n fetch --call-id call_custom123', root);
    expect(output).toContain('call_custom123');
  });

  it('should capture a tool result linked to a call', () => {
    // Capture the call
    run('capture tool-call -n search --call-id call_link_test', root);

    // Capture the result
    const output = run('capture tool-result -n search -o "Found 3 results" --call-id call_link_test', root);
    expect(output).toContain('Tool result captured');
    expect(output).toContain('call_link_test');

    // Verify correlation
    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();
    const report = correlateEvents(events);

    expect(report.toolPairs).toHaveLength(1);
    expect(report.toolPairs[0].callId).toBe('call_link_test');
    expect(report.toolPairs[0].result).not.toBeNull();
    expect(report.totalCorrelated).toBe(1);
  });

  it('should capture a tool error result', () => {
    run('capture tool-call -n api --call-id call_err', root);
    const output = run('capture tool-result -n api -o "Timeout" --call-id call_err --is-error', root);
    expect(output).toContain('Tool result captured');

    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();
    const result = events.find((e) => e.type === 'tool_result') as ToolResultEvent;
    expect(result.payload.isError).toBe(true);
  });

  it('should capture tool result without callId (unlinked)', () => {
    const output = run('capture tool-result -n manual -o "standalone result"', root);
    expect(output).toContain('unlinked');
  });
});

describe('capture command with correlation', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-cmd-corr-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Cmd Corr Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    const sess = startSession(root, { projectId }).data!;
    sessionId = sess.id;
    setActiveSession(root, sessionId);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should link command and output via commandEventId', () => {
    run('capture command -c "npm test" --stdout "PASS" --exit-code 0', root);

    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();

    expect(events).toHaveLength(2);

    const cmd = events[0] as CommandEvent;
    const out = events[1] as CommandOutputEvent;

    expect(cmd.type).toBe('command');
    expect(out.type).toBe('command_output');
    expect(out.payload.commandEventId).toBe(cmd.id);

    // Verify via correlation engine
    const report = correlateEvents(events);
    expect(report.commandPairs).toHaveLength(1);
    expect(report.commandPairs[0].output!.payload.exitCode).toBe(0);
    expect(report.totalCorrelated).toBe(1);
  });

  it('should capture command without output (no correlation needed)', () => {
    run('capture command -c "echo hello"', root);

    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('command');
  });

  it('should show tool-call and tool-result in help', () => {
    const output = run('capture --help', root);
    expect(output).toContain('tool-call');
    expect(output).toContain('tool-result');
  });
});
