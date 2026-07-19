/**
 * Correlation engine for linking related events.
 *
 * Relationships:
 *   tool_call  → tool_result     linked by callId
 *   command    → command_output   linked by commandEventId
 *
 * The correlation engine generates callIds for tool calls,
 * stores the calling event's ID as the commandEventId for
 * commands, and provides lookup utilities to trace the
 * full call→result chain from a ledger.
 */

import { randomUUID } from 'crypto';
import type { ContinuumEvent, ToolCallEvent, ToolResultEvent, CommandEvent, CommandOutputEvent } from '../events/types';
import { EventTypes } from '../events/types';

// ─── ID generation ──────────────────────────────────────────

export function generateCallId(): string {
  return `call_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

// ─── Correlated pair types ──────────────────────────────────

export interface ToolPair {
  call: ToolCallEvent;
  result: ToolResultEvent | null;
  callId: string;
}

export interface CommandPair {
  command: CommandEvent;
  output: CommandOutputEvent | null;
  commandEventId: string;
}

export type CorrelatedPair = ToolPair | CommandPair;

export interface CorrelationReport {
  toolPairs: ToolPair[];
  commandPairs: CommandPair[];
  unmatchedToolCalls: ToolCallEvent[];
  unmatchedToolResults: ToolResultEvent[];
  unmatchedCommandOutputs: CommandOutputEvent[];
  totalCorrelated: number;
  totalUnmatched: number;
}

// ─── Build correlations from events ─────────────────────────

export function correlateEvents(events: ContinuumEvent[]): CorrelationReport {
  const toolCalls = new Map<string, ToolCallEvent>();
  const toolResults = new Map<string, ToolResultEvent>();
  const commands = new Map<string, CommandEvent>();
  const commandOutputs = new Map<string, CommandOutputEvent>();

  // Index all events by their correlation keys
  for (const event of events) {
    switch (event.type) {
      case EventTypes.TOOL_CALL: {
        const tc = event as ToolCallEvent;
        const callId = tc.payload.callId ?? tc.id;
        toolCalls.set(callId, tc);
        break;
      }
      case EventTypes.TOOL_RESULT: {
        const tr = event as ToolResultEvent;
        const callId = tr.payload.callId ?? '';
        if (callId) toolResults.set(callId, tr);
        break;
      }
      case EventTypes.COMMAND: {
        const cmd = event as CommandEvent;
        commands.set(cmd.id, cmd);
        break;
      }
      case EventTypes.COMMAND_OUTPUT: {
        const out = event as CommandOutputEvent;
        const cmdId = out.payload.commandEventId;
        if (cmdId) commandOutputs.set(cmdId, out);
        break;
      }
    }
  }

  // Match tool_call → tool_result by callId
  const toolPairs: ToolPair[] = [];
  const matchedToolCallIds = new Set<string>();
  const matchedToolResultIds = new Set<string>();

  for (const [callId, call] of toolCalls) {
    const result = toolResults.get(callId) ?? null;
    toolPairs.push({ call, result, callId });
    matchedToolCallIds.add(callId);
    if (result) matchedToolResultIds.add(callId);
  }

  // Match command → command_output by commandEventId
  const commandPairs: CommandPair[] = [];
  const matchedCommandIds = new Set<string>();
  const matchedOutputIds = new Set<string>();

  for (const [cmdId, cmd] of commands) {
    const output = commandOutputs.get(cmdId) ?? null;
    commandPairs.push({ command: cmd, output, commandEventId: cmdId });
    matchedCommandIds.add(cmdId);
    if (output) matchedOutputIds.add(cmdId);
  }

  // Collect unmatched
  const unmatchedToolCalls: ToolCallEvent[] = [];
  for (const [callId, call] of toolCalls) {
    if (!matchedToolResultIds.has(callId)) {
      // Call exists but no result paired
      // Already in toolPairs with result: null — only truly unmatched
    }
  }

  const unmatchedToolResults: ToolResultEvent[] = [];
  for (const [callId, result] of toolResults) {
    if (!matchedToolCallIds.has(callId)) {
      unmatchedToolResults.push(result);
    }
  }

  const unmatchedCommandOutputs: CommandOutputEvent[] = [];
  for (const [cmdId, output] of commandOutputs) {
    if (!matchedCommandIds.has(cmdId)) {
      unmatchedCommandOutputs.push(output);
    }
  }

  const totalCorrelated =
    toolPairs.filter((p) => p.result !== null).length +
    commandPairs.filter((p) => p.output !== null).length;

  const totalUnmatched =
    toolPairs.filter((p) => p.result === null).length +
    unmatchedToolResults.length +
    commandPairs.filter((p) => p.output === null).length +
    unmatchedCommandOutputs.length;

  return {
    toolPairs,
    commandPairs,
    unmatchedToolCalls,
    unmatchedToolResults,
    unmatchedCommandOutputs,
    totalCorrelated,
    totalUnmatched,
  };
}

// ─── Find the result for a specific call ────────────────────

export function findToolResult(events: ContinuumEvent[], callId: string): ToolResultEvent | null {
  for (const event of events) {
    if (event.type === EventTypes.TOOL_RESULT) {
      const tr = event as ToolResultEvent;
      if (tr.payload.callId === callId) return tr;
    }
  }
  return null;
}

export function findCommandOutput(events: ContinuumEvent[], commandEventId: string): CommandOutputEvent | null {
  for (const event of events) {
    if (event.type === EventTypes.COMMAND_OUTPUT) {
      const co = event as CommandOutputEvent;
      if (co.payload.commandEventId === commandEventId) return co;
    }
  }
  return null;
}

export function findToolCall(events: ContinuumEvent[], callId: string): ToolCallEvent | null {
  for (const event of events) {
    if (event.type === EventTypes.TOOL_CALL) {
      const tc = event as ToolCallEvent;
      if (tc.payload.callId === callId || tc.id === callId) return tc;
    }
  }
  return null;
}
