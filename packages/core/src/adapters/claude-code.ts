/**
 * Claude Code native session log adapter.
 *
 * ST1: Parses the local JSONL session log Claude Code writes to
 * ~/.claude/projects/<escaped-cwd>/<session-id>.jsonl — one JSON
 * object per line, distinct from the Anthropic API export format:
 *
 *   { "type": "user", "message": { "role": "user", "content": [...] },
 *     "uuid": "...", "parentUuid": "...", "sessionId": "...",
 *     "cwd": "...", "timestamp": "..." }
 *   { "type": "assistant", "message": { "role": "assistant", "content": [...] }, ... }
 *   { "type": "queue-operation" | "attachment" | "file-history-snapshot" |
 *            "file-history-delta" | "ai-title" | "last-prompt" | "summary", ... }
 *
 * Only "user" and "assistant" lines carry conversation content; the
 * rest are Claude Code bookkeeping and are skipped.
 *
 * ST2: Maps content blocks to canonical events, same as the Anthropic
 * API adapter:
 *   - text blocks → message events
 *   - tool_use blocks → tool_call events
 *   - tool_result blocks → tool_result events
 *   - thinking blocks → skipped (internal reasoning, not transferable state)
 *   - isSidechain messages (Task subagent turns) → skipped by default
 */

import type { Adapter } from './types';
import type { ParsedMessage, ParseResult, ImportWarning } from '../import/types';
import { WarningTypes } from '../import/types';

// ─── Line shapes ─────────────────────────────────────────────

interface TextBlock {
  type: 'text';
  text: string;
}

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

interface ClaudeCodeMessage {
  role: string;
  content: string | ContentBlock[];
  model?: string;
}

interface ClaudeCodeLine {
  type: string;
  message?: ClaudeCodeMessage;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  timestamp?: string;
}

const CONTENT_LINE_TYPES = new Set(['user', 'assistant']);

// ─── Line parsing ────────────────────────────────────────────

function parseLines(raw: string): { lines: ClaudeCodeLine[]; malformed: number } {
  const lines: ClaudeCodeLine[] = [];
  let malformed = 0;

  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        lines.push(parsed as ClaudeCodeLine);
      } else {
        malformed++;
      }
    } catch {
      malformed++;
    }
  }

  return { lines, malformed };
}

// ─── Detection ──────────────────────────────────────────────

function looksLikeClaudeCodeLine(line: ClaudeCodeLine): boolean {
  if (typeof line.sessionId !== 'string') return false;

  if (CONTENT_LINE_TYPES.has(line.type)) {
    return typeof line.uuid === 'string' && typeof line.cwd === 'string' && !!line.message;
  }

  return ['queue-operation', 'attachment', 'file-history-snapshot', 'file-history-delta', 'ai-title', 'last-prompt', 'summary'].includes(
    line.type,
  );
}

function looksLikeClaudeCode(raw: string): boolean {
  const { lines } = parseLines(raw);
  if (lines.length === 0) return false;

  // Require at least one recognizable Claude Code line, and no lines
  // that outright contradict the format (all lines must be objects
  // with a "type" field, since that's universal across every line kind).
  let sawContentLine = false;

  for (const line of lines) {
    if (typeof line.type !== 'string') return false;
    if (CONTENT_LINE_TYPES.has(line.type) && looksLikeClaudeCodeLine(line)) {
      sawContentLine = true;
    }
  }

  return sawContentLine;
}

// ─── Parse content blocks (ST2) ──────────────────────────────

// Claude Code injects IDE/harness bookkeeping directly into user message
// text (selection context, system reminders, opened-file notices). These
// aren't things the user said — strip them so extracted state reflects
// actual conversation content, not editor noise.
const IDE_NOISE_TAGS = ['ide_selection', 'system-reminder', 'ide_opened_file'];

function stripIdeNoise(text: string): string {
  let cleaned = text;
  for (const tag of IDE_NOISE_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), '');
  }
  return cleaned.trim();
}

function extractToolResultContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text!)
      .join('\n');
  }

  return '';
}

function parseContentLines(
  lines: ClaudeCodeLine[],
  warnings: ImportWarning[],
): ParsedMessage[] {
  const result: ParsedMessage[] = [];
  let lineIndex = -1;

  for (const line of lines) {
    lineIndex++;
    if (!CONTENT_LINE_TYPES.has(line.type)) continue;

    const msg = line.message;
    if (!msg) continue;

    if (line.isSidechain) {
      warnings.push({
        type: WarningTypes.SKIPPED_MESSAGE,
        field: `[${lineIndex}]`,
        message: `Sidechain (subagent) message at line ${lineIndex} skipped.`,
        messageIndex: lineIndex,
      });
      continue;
    }

    const role = (msg.role ?? '').toLowerCase();
    if (!role) {
      warnings.push({
        type: WarningTypes.SKIPPED_MESSAGE,
        field: `[${lineIndex}].message.role`,
        message: `Line ${lineIndex} has no role. Skipped.`,
        messageIndex: lineIndex,
      });
      continue;
    }

    // Simple string content (rare in Claude Code logs, but handle defensively)
    if (typeof msg.content === 'string') {
      if (msg.content.length === 0) continue;
      result.push({ role, content: msg.content, unmappedFields: { model: msg.model } });
      continue;
    }

    if (!Array.isArray(msg.content)) continue;

    for (let b = 0; b < msg.content.length; b++) {
      const block = msg.content[b];

      switch (block.type) {
        case 'text': {
          const text = role === 'user' ? stripIdeNoise((block as TextBlock).text) : (block as TextBlock).text;
          if (text.length === 0) continue;

          result.push({
            role,
            content: text,
            unmappedFields: msg.model ? { model: msg.model, blockIndex: b } : { blockIndex: b },
          });
          break;
        }

        case 'thinking':
          // Internal reasoning — not transferable state, skip quietly.
          break;

        case 'tool_use': {
          const tu = block as ToolUseBlock;
          result.push({
            role: '__tool_call__',
            content: JSON.stringify({
              toolName: tu.name,
              input: tu.input ?? {},
              callId: tu.id,
            }),
            unmappedFields: { originalRole: role, blockIndex: b },
          });
          break;
        }

        case 'tool_result': {
          const tr = block as ToolResultBlock;
          result.push({
            role: '__tool_result__',
            content: JSON.stringify({
              toolName: 'unknown',
              output: extractToolResultContent(tr.content),
              callId: tr.tool_use_id,
              isError: tr.is_error ?? false,
            }),
            unmappedFields: { originalRole: role, blockIndex: b },
          });
          break;
        }

        default: {
          warnings.push({
            type: WarningTypes.UNSUPPORTED_FIELD,
            field: `[${lineIndex}].message.content[${b}].type`,
            message: `Unknown content block type "${(block as Record<string, unknown>).type}" at line ${lineIndex}. Skipped.`,
            messageIndex: lineIndex,
          });
        }
      }
    }
  }

  return result;
}

// ─── Adapter implementation ─────────────────────────────────

export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  name: 'Claude Code (local session log)',
  provider: 'anthropic',
  extensions: ['.jsonl'],

  canParse(raw: string): boolean {
    return looksLikeClaudeCode(raw);
  },

  parse(raw: string): ParseResult {
    const { lines, malformed } = parseLines(raw);
    const warnings: ImportWarning[] = [];

    if (malformed > 0) {
      warnings.push({
        type: WarningTypes.INACCESSIBLE,
        field: 'root',
        message: `${malformed} line(s) could not be parsed as JSON and were skipped.`,
      });
    }

    return {
      messages: parseContentLines(lines, warnings),
      format: 'json',
      warnings,
      detectedProvider: 'anthropic',
    };
  },
};
