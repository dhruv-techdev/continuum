/**
 * Claude conversation export adapter.
 *
 * ST1: Parses the Anthropic API conversation format:
 *   [
 *     { "role": "user", "content": "..." },
 *     { "role": "assistant", "content": [
 *       { "type": "text", "text": "..." },
 *       { "type": "tool_use", "id": "toolu_...", "name": "...", "input": {...} }
 *     ]},
 *     { "role": "user", "content": [
 *       { "type": "tool_result", "tool_use_id": "toolu_...", "content": "..." }
 *     ]}
 *   ]
 *
 * ST2: Maps content blocks to canonical events:
 *   - text blocks → message events
 *   - tool_use blocks → tool_call events
 *   - tool_result blocks → tool_result events
 *   - Preserves tool_use_id as callId for correlation
 */

import type { Adapter } from './types';
import type { ParsedMessage, ParseResult, ImportWarning } from '../import/types';
import { WarningTypes } from '../import/types';

// ─── Content block types ────────────────────────────────────

interface TextBlock {
  type: 'text';
  text: string;
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

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ClaudeMessage {
  role: string;
  content: string | ContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
}

// ─── Detection ──────────────────────────────────────────────

function looksLikeClaude(parsed: unknown): boolean {
  if (!Array.isArray(parsed)) {
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // Wrapped format: { messages: [...] } or API response with content blocks
      if (Array.isArray(obj.messages)) return looksLikeClaude(obj.messages);
      if (
        obj.role &&
        obj.content &&
        obj.model &&
        typeof obj.model === 'string' &&
        (obj.model as string).includes('claude')
      )
        return true;
    }
    return false;
  }

  // Check if messages have Claude-style content blocks
  for (const msg of parsed) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;

    // Claude API responses have content as array of blocks
    if (Array.isArray(m.content)) {
      const blocks = m.content as Array<Record<string, unknown>>;
      for (const block of blocks) {
        if (block.type === 'tool_use' || block.type === 'tool_result') return true;
        if (block.type === 'text' && typeof block.text === 'string') return true;
      }
    }

    // Check for Claude-specific fields
    if (typeof m.model === 'string' && (m.model as string).includes('claude')) return true;
    if (m.stop_reason !== undefined) return true;
  }

  return false;
}

// ─── Parse content blocks (ST2) ─────────────────────────────

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

function parseClaudeMessages(
  messages: ClaudeMessage[],
  warnings: ImportWarning[],
): ParsedMessage[] {
  const result: ParsedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = (msg.role ?? '').toLowerCase();

    if (!role) {
      warnings.push({
        type: WarningTypes.SKIPPED_MESSAGE,
        field: `[${i}].role`,
        message: `Message at index ${i} has no role. Skipped.`,
        messageIndex: i,
      });
      continue;
    }

    // Simple string content
    if (typeof msg.content === 'string') {
      const unmapped: Record<string, unknown> = {};
      if (msg.model) unmapped.model = msg.model;
      if (msg.stop_reason) unmapped.stop_reason = msg.stop_reason;
      if (msg.usage) unmapped.usage = msg.usage;

      if (Object.keys(unmapped).length > 0) {
        for (const key of Object.keys(unmapped)) {
          warnings.push({
            type: WarningTypes.UNSUPPORTED_FIELD,
            field: `[${i}].${key}`,
            message: `Field "${key}" preserved in metadata.`,
            messageIndex: i,
          });
        }
      }

      result.push({ role, content: msg.content, unmappedFields: unmapped });
      continue;
    }

    // Content block array (ST2 — map each block type)
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as ContentBlock[];

      for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];

        switch (block.type) {
          case 'text': {
            const text = (block as TextBlock).text;
            if (text.length === 0) {
              warnings.push({
                type: WarningTypes.EMPTY_CONTENT,
                field: `[${i}].content[${b}]`,
                message: `Empty text block at message ${i}, block ${b}.`,
                messageIndex: i,
              });
            }

            const unmapped: Record<string, unknown> = { blockIndex: b };
            if (msg.model) {
              unmapped.model = msg.model;
              warnings.push({
                type: WarningTypes.UNSUPPORTED_FIELD,
                field: `[${i}].model`,
                message: `Field "model" preserved in metadata.`,
                messageIndex: i,
              });
            }
            if (msg.stop_reason) {
              unmapped.stop_reason = msg.stop_reason;
              warnings.push({
                type: WarningTypes.UNSUPPORTED_FIELD,
                field: `[${i}].stop_reason`,
                message: `Field "stop_reason" preserved in metadata.`,
                messageIndex: i,
              });
            }

            result.push({ role, content: text, unmappedFields: unmapped });
            break;
          }

          case 'tool_use': {
            const tu = block as ToolUseBlock;

            // Map to a special role marker that the normalizer will handle
            result.push({
              role: '__tool_call__',
              content: JSON.stringify({
                toolName: tu.name,
                input: tu.input,
                callId: tu.id,
              }),
              unmappedFields: {
                originalRole: role,
                blockType: 'tool_use',
                blockIndex: b,
                model: msg.model,
              },
            });
            break;
          }

          case 'tool_result': {
            const tr = block as ToolResultBlock;
            const output = extractToolResultContent(tr.content);

            result.push({
              role: '__tool_result__',
              content: JSON.stringify({
                toolName: 'unknown', // tool_result doesn't carry the name
                output,
                callId: tr.tool_use_id,
                isError: tr.is_error ?? false,
              }),
              unmappedFields: {
                originalRole: role,
                blockType: 'tool_result',
                blockIndex: b,
              },
            });
            break;
          }

          default: {
            warnings.push({
              type: WarningTypes.UNSUPPORTED_FIELD,
              field: `[${i}].content[${b}].type`,
              message: `Unknown content block type "${(block as Record<string, unknown>).type}". Skipped.`,
              messageIndex: i,
            });
          }
        }
      }

      continue;
    }

    // Unknown content type
    warnings.push({
      type: WarningTypes.SKIPPED_MESSAGE,
      field: `[${i}].content`,
      message: `Message ${i} has unsupported content type. Skipped.`,
      messageIndex: i,
    });
  }

  return result;
}

// ─── Adapter implementation ─────────────────────────────────

export const claudeAdapter: Adapter = {
  id: 'claude',
  name: 'Claude (Anthropic API)',
  provider: 'anthropic',
  extensions: ['.json'],

  canParse(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw);
      return looksLikeClaude(parsed);
    } catch {
      return false;
    }
  },

  parse(raw: string): ParseResult {
    const warnings: ImportWarning[] = [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        messages: [],
        format: 'json',
        warnings: [
          {
            type: WarningTypes.INACCESSIBLE,
            field: 'root',
            message: `Invalid JSON: ${(err as Error).message}`,
          },
        ],
        detectedProvider: 'anthropic',
      };
    }

    // Unwrap if needed
    let messages: ClaudeMessage[];

    if (Array.isArray(parsed)) {
      messages = parsed as ClaudeMessage[];
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      if (Array.isArray(obj.messages)) {
        messages = obj.messages as ClaudeMessage[];

        // Report other top-level fields
        for (const key of Object.keys(obj)) {
          if (key !== 'messages') {
            warnings.push({
              type: WarningTypes.UNSUPPORTED_FIELD,
              field: key,
              message: `Top-level field "${key}" preserved in import metadata.`,
            });
          }
        }
      } else if (obj.role && obj.content) {
        // Single message (API response)
        messages = [obj as unknown as ClaudeMessage];

        warnings.push({
          type: WarningTypes.COERCED,
          field: 'root',
          message: 'Single API response wrapped as a one-message conversation.',
        });
      } else {
        return {
          messages: [],
          format: 'json',
          warnings: [
            {
              type: WarningTypes.INACCESSIBLE,
              field: 'root',
              message: 'Unrecognized Claude export structure.',
            },
          ],
          detectedProvider: 'anthropic',
        };
      }
    } else {
      return {
        messages: [],
        format: 'json',
        warnings: [
          {
            type: WarningTypes.INACCESSIBLE,
            field: 'root',
            message: 'Expected a JSON array or object.',
          },
        ],
        detectedProvider: 'anthropic',
      };
    }

    return {
      messages: parseClaudeMessages(messages, warnings),
      format: 'json',
      warnings,
      detectedProvider: 'anthropic',
    };
  },
};
