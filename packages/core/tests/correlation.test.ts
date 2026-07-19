import { describe, it, expect } from 'vitest';
import {
  generateCallId,
  correlateEvents,
  findToolResult,
  findCommandOutput,
  findToolCall,
  createEvent,
  EventTypes,
  MessageRoles,
} from '../src/index';
import type { ContinuumEvent, ToolCallEvent, ToolResultEvent, CommandEvent, CommandOutputEvent } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';
const PID = 'proj_test';
const SID = 'sess_test';

// ─── Helpers ────────────────────────────────────────────────

function toolCall(seq: number, toolName: string, callId: string): ToolCallEvent {
  return createEvent({
    type: EventTypes.TOOL_CALL,
    projectId: PID, sessionId: SID, sequence: seq, source: 'test', timestamp: TS,
    payload: { toolName, input: { query: 'test' }, callId },
  });
}

function toolResult(seq: number, toolName: string, callId: string, output: string, isError = false): ToolResultEvent {
  return createEvent({
    type: EventTypes.TOOL_RESULT,
    projectId: PID, sessionId: SID, sequence: seq, source: 'test', timestamp: TS,
    payload: { toolName, output, callId, isError },
  });
}

function command(seq: number, cmd: string): CommandEvent {
  return createEvent({
    type: EventTypes.COMMAND,
    projectId: PID, sessionId: SID, sequence: seq, source: 'test', timestamp: TS,
    payload: { command: cmd },
  });
}

function commandOutput(seq: number, cmdEventId: string, stdout: string, exitCode: number): CommandOutputEvent {
  return createEvent({
    type: EventTypes.COMMAND_OUTPUT,
    projectId: PID, sessionId: SID, sequence: seq, source: 'test', timestamp: TS,
    payload: { commandEventId: cmdEventId, stdout, exitCode },
  });
}

function message(seq: number, content: string): ContinuumEvent {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: PID, sessionId: SID, sequence: seq, source: 'test', timestamp: TS,
    payload: { role: MessageRoles.USER, content },
  });
}

// ─── generateCallId ─────────────────────────────────────────

describe('generateCallId()', () => {
  it('should produce call_ prefixed IDs', () => {
    const id = generateCallId();
    expect(id).toMatch(/^call_[0-9a-f]{12}$/);
  });

  it('should produce unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateCallId()));
    expect(ids.size).toBe(50);
  });
});

// ─── correlateEvents ────────────────────────────────────────

describe('correlateEvents()', () => {
  // ── Tool call → result (ST3) ────────────────────────────

  describe('tool call → result correlation', () => {
    it('should pair a tool call with its result by callId', () => {
      const call = toolCall(0, 'web_search', 'call_abc');
      const result = toolResult(1, 'web_search', 'call_abc', 'search results');

      const report = correlateEvents([call, result]);

      expect(report.toolPairs).toHaveLength(1);
      expect(report.toolPairs[0].callId).toBe('call_abc');
      expect(report.toolPairs[0].call.id).toBe(call.id);
      expect(report.toolPairs[0].result!.id).toBe(result.id);
      expect(report.totalCorrelated).toBe(1);
    });

    it('should handle multiple tool call/result pairs', () => {
      const events: ContinuumEvent[] = [
        toolCall(0, 'search', 'call_1'),
        toolResult(1, 'search', 'call_1', 'results 1'),
        toolCall(2, 'fetch', 'call_2'),
        toolResult(3, 'fetch', 'call_2', 'page content'),
        toolCall(4, 'calculate', 'call_3'),
        toolResult(5, 'calculate', 'call_3', '42'),
      ];

      const report = correlateEvents(events);

      expect(report.toolPairs).toHaveLength(3);
      expect(report.totalCorrelated).toBe(3);
      expect(report.totalUnmatched).toBe(0);
    });

    it('should report unmatched tool calls (no result)', () => {
      const events: ContinuumEvent[] = [
        toolCall(0, 'search', 'call_orphan'),
      ];

      const report = correlateEvents(events);

      expect(report.toolPairs).toHaveLength(1);
      expect(report.toolPairs[0].result).toBeNull();
      expect(report.totalUnmatched).toBe(1);
    });

    it('should report unmatched tool results (no call)', () => {
      const events: ContinuumEvent[] = [
        toolResult(0, 'search', 'call_mystery', 'some result'),
      ];

      const report = correlateEvents(events);

      expect(report.unmatchedToolResults).toHaveLength(1);
      expect(report.totalUnmatched).toBe(1);
    });

    it('should handle error results', () => {
      const events: ContinuumEvent[] = [
        toolCall(0, 'api', 'call_err'),
        toolResult(1, 'api', 'call_err', 'timeout error', true),
      ];

      const report = correlateEvents(events);

      expect(report.toolPairs).toHaveLength(1);
      expect(report.toolPairs[0].result!.payload.isError).toBe(true);
      expect(report.totalCorrelated).toBe(1);
    });
  });

  // ── Command → output (ST2 + ST3) ───────────────────────

  describe('command → output correlation', () => {
    it('should pair a command with its output by commandEventId', () => {
      const cmd = command(0, 'npm test');
      const out = commandOutput(1, cmd.id, '42 tests passed', 0);

      const report = correlateEvents([cmd, out]);

      expect(report.commandPairs).toHaveLength(1);
      expect(report.commandPairs[0].commandEventId).toBe(cmd.id);
      expect(report.commandPairs[0].command.id).toBe(cmd.id);
      expect(report.commandPairs[0].output!.id).toBe(out.id);
      expect(report.commandPairs[0].output!.payload.exitCode).toBe(0);
      expect(report.totalCorrelated).toBe(1);
    });

    it('should handle commands without output', () => {
      const events: ContinuumEvent[] = [command(0, 'echo hello')];

      const report = correlateEvents(events);

      expect(report.commandPairs).toHaveLength(1);
      expect(report.commandPairs[0].output).toBeNull();
      expect(report.totalUnmatched).toBe(1);
    });

    it('should report orphaned command outputs', () => {
      const events: ContinuumEvent[] = [
        commandOutput(0, 'evt_nonexistent', 'output', 0),
      ];

      const report = correlateEvents(events);

      expect(report.unmatchedCommandOutputs).toHaveLength(1);
      expect(report.totalUnmatched).toBe(1);
    });

    it('should handle multiple command pairs', () => {
      const cmd1 = command(0, 'npm install');
      const out1 = commandOutput(1, cmd1.id, 'installed', 0);
      const cmd2 = command(2, 'npm test');
      const out2 = commandOutput(3, cmd2.id, 'FAIL', 1);

      const report = correlateEvents([cmd1, out1, cmd2, out2]);

      expect(report.commandPairs).toHaveLength(2);
      expect(report.totalCorrelated).toBe(2);
      expect(report.commandPairs[1].output!.payload.exitCode).toBe(1);
    });
  });

  // ── Mixed event types ───────────────────────────────────

  describe('mixed event streams', () => {
    it('should handle messages, tool calls, and commands together', () => {
      const cmd1 = command(0, 'git status');
      const events: ContinuumEvent[] = [
        message(0, 'User asked a question'),
        toolCall(1, 'search', 'call_1'),
        toolResult(2, 'search', 'call_1', 'results'),
        message(3, 'Assistant answered'),
        cmd1,
        commandOutput(5, cmd1.id, 'modified: file.ts', 0),
        toolCall(6, 'fetch', 'call_2'),
        // No result for call_2 — it's pending
      ];

      // Fix sequences to be monotonic
      const fixed = events.map((e, i) => ({ ...e, sequence: i }));
      const report = correlateEvents(fixed as ContinuumEvent[]);

      expect(report.toolPairs).toHaveLength(2);
      expect(report.commandPairs).toHaveLength(1);
      expect(report.totalCorrelated).toBe(2); // search + git status
      expect(report.totalUnmatched).toBe(1); // pending fetch
    });

    it('should return empty report for no events', () => {
      const report = correlateEvents([]);

      expect(report.toolPairs).toHaveLength(0);
      expect(report.commandPairs).toHaveLength(0);
      expect(report.totalCorrelated).toBe(0);
      expect(report.totalUnmatched).toBe(0);
    });

    it('should return empty report for only message events', () => {
      const events: ContinuumEvent[] = [
        message(0, 'Hello'),
        message(1, 'World'),
      ];

      const report = correlateEvents(events);

      expect(report.toolPairs).toHaveLength(0);
      expect(report.commandPairs).toHaveLength(0);
    });
  });
});

// ─── Lookup utilities ───────────────────────────────────────

describe('findToolResult()', () => {
  it('should find a result by callId', () => {
    const events: ContinuumEvent[] = [
      toolCall(0, 'search', 'call_find'),
      toolResult(1, 'search', 'call_find', 'found it'),
    ];

    const result = findToolResult(events, 'call_find');
    expect(result).not.toBeNull();
    expect(result!.payload.output).toBe('found it');
  });

  it('should return null when no match', () => {
    const events: ContinuumEvent[] = [
      toolCall(0, 'search', 'call_a'),
    ];

    expect(findToolResult(events, 'call_a')).toBeNull();
  });
});

describe('findCommandOutput()', () => {
  it('should find output by commandEventId', () => {
    const cmd = command(0, 'ls');
    const events: ContinuumEvent[] = [
      cmd,
      commandOutput(1, cmd.id, 'file.ts', 0),
    ];

    const result = findCommandOutput(events, cmd.id);
    expect(result).not.toBeNull();
    expect(result!.payload.stdout).toBe('file.ts');
  });

  it('should return null when no match', () => {
    expect(findCommandOutput([], 'evt_nope')).toBeNull();
  });
});

describe('findToolCall()', () => {
  it('should find a call by callId', () => {
    const events: ContinuumEvent[] = [
      toolCall(0, 'search', 'call_lookup'),
    ];

    const result = findToolCall(events, 'call_lookup');
    expect(result).not.toBeNull();
    expect(result!.payload.toolName).toBe('search');
  });

  it('should find a call by event ID as fallback', () => {
    const tc = toolCall(0, 'search', 'call_x');
    const result = findToolCall([tc], tc.id);
    expect(result).not.toBeNull();
  });

  it('should return null when no match', () => {
    expect(findToolCall([], 'call_nope')).toBeNull();
  });
});
