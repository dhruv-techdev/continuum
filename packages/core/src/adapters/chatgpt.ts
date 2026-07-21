/**
 * ChatGPT / OpenAI conversation export adapter.
 *
 * ST1: Parses two shapes:
 *   1. OpenAI Chat Completions API messages:
 *      [
 *        { "role": "user", "content": "..." },
 *        { "role": "assistant", "content": null, "tool_calls": [
 *          { "id": "call_...", "type": "function", "function": { "name": "...", "arguments": "{...}" } }
 *        ]},
 *        { "role": "tool", "tool_call_id": "call_...", "content": "..." }
 *      ]
 *
 *   2. ChatGPT web export ("conversations.json" from Settings → Data export),
 *      a tree of nodes keyed by id:
 *      {
 *        "title": "...",
 *        "mapping": {
 *          "<node-id>": {
 *            "id": "<node-id>",
 *            "message": {
 *              "author": { "role": "user" | "assistant" | "system" | "tool" },
 *              "content": { "content_type": "text", "parts": ["..."] },
 *              "create_time": 1700000000
 *            },
 *            "parent": "<parent-node-id>" | null,
 *            "children": ["<child-node-id>", ...]
 *          }
 *        },
 *        "current_node": "<node-id>"
 *      }
 *
 * ST2: Maps to canonical events:
 *   - text parts → message events
 *   - tool_calls / function_call → tool_call events
 *   - role "tool" messages → tool_result events
 *   - Preserves call IDs for correlation
 */

import type { Adapter } from './types';
import type { ParsedMessage, ParseResult, ImportWarning } from '../import/types';
import { WarningTypes } from '../import/types';

// ─── Chat Completions shape ─────────────────────────────────

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface ChatCompletionMessage {
  role: string;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  function_call?: { name: string; arguments: string };
  model?: string;
}

// ─── ChatGPT web export (tree) shape ────────────────────────

interface ExportContent {
  content_type: string;
  parts?: unknown[];
  text?: string;
}

interface ExportMessage {
  id?: string;
  author: { role: string; name?: string };
  content: ExportContent;
  create_time?: number | null;
  metadata?: Record<string, unknown>;
  recipient?: string;
}

interface ExportNode {
  id: string;
  message: ExportMessage | null;
  parent: string | null;
  children: string[];
}

interface ExportConversation {
  title?: string;
  mapping: Record<string, ExportNode>;
  current_node?: string;
}

// ─── Detection ──────────────────────────────────────────────

function isExportConversation(obj: Record<string, unknown>): boolean {
  return typeof obj.mapping === 'object' && obj.mapping !== null;
}

function looksLikeChatGPT(parsed: unknown): boolean {
  // ChatGPT web export: array of conversations, or a single conversation object
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object' && isExportConversation(item as Record<string, unknown>)) {
        return true;
      }
    }

    // Chat Completions-style message array
    for (const msg of parsed) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;
      if (Array.isArray(m.tool_calls)) return true;
      if (m.role === 'tool' && m.tool_call_id) return true;
      if (m.function_call && typeof m.function_call === 'object') return true;
      if (typeof m.model === 'string' && /gpt|o[134]/i.test(m.model)) return true;
    }

    return false;
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (isExportConversation(obj)) return true;
    if (Array.isArray(obj.messages)) return looksLikeChatGPT(obj.messages);
  }

  return false;
}

// ─── Parse ChatGPT web export tree into linear messages ─────

function extractExportText(content: ExportContent): string {
  const type = content.content_type;
  if (type === undefined || type === 'text' || type === 'code') {
    if (Array.isArray(content.parts)) {
      return content.parts
        .filter((p): p is string => typeof p === 'string')
        .join('\n');
    }
    if (typeof content.text === 'string') return content.text;
  }
  return '';
}

function linearizeConversation(conv: ExportConversation): ExportNode[] {
  const { mapping } = conv;
  const ordered: ExportNode[] = [];

  // Walk backward from current_node via parent pointers to capture the
  // active branch, then reverse for chronological order. Falls back to
  // create_time sort if there's no current_node.
  if (conv.current_node && mapping[conv.current_node]) {
    let node: ExportNode | undefined = mapping[conv.current_node];
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      ordered.push(node);
      node = node.parent ? mapping[node.parent] : undefined;
    }
    return ordered.reverse();
  }

  return Object.values(mapping).sort(
    (a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0),
  );
}

function parseExportConversation(
  conv: ExportConversation,
  warnings: ImportWarning[],
  startIndex: number,
): ParsedMessage[] {
  const result: ParsedMessage[] = [];
  const nodes = linearizeConversation(conv);

  for (let n = 0; n < nodes.length; n++) {
    const i = startIndex + n;
    const msg = nodes[n].message;

    if (!msg) continue;

    const role = (msg.author?.role ?? '').toLowerCase();
    if (!role) {
      warnings.push({
        type: WarningTypes.SKIPPED_MESSAGE,
        field: `[${i}].author.role`,
        message: `Node at index ${i} has no author role. Skipped.`,
        messageIndex: i,
      });
      continue;
    }

    // Tool/plugin invocation surfaced as an assistant message directed at a tool
    if (role === 'assistant' && msg.recipient && msg.recipient !== 'all') {
      result.push({
        role: '__tool_call__',
        content: JSON.stringify({
          toolName: msg.recipient,
          input: { text: extractExportText(msg.content) },
          callId: msg.id ?? `call_${i}`,
        }),
        unmappedFields: { originalRole: role, source: 'chatgpt_export' },
      });
      continue;
    }

    // Tool/plugin result
    if (role === 'tool') {
      result.push({
        role: '__tool_result__',
        content: JSON.stringify({
          toolName: msg.author.name ?? 'unknown',
          output: extractExportText(msg.content),
          callId: msg.id ?? `call_${i}`,
          isError: false,
        }),
        unmappedFields: { originalRole: role, source: 'chatgpt_export' },
      });
      continue;
    }

    const text = extractExportText(msg.content);
    if (text.length === 0) {
      // System/hidden nodes with empty content are common in the export tree; skip quietly.
      if (role !== 'system') {
        warnings.push({
          type: WarningTypes.EMPTY_CONTENT,
          field: `[${i}].content`,
          message: `Empty content at message ${i}. Skipped.`,
          messageIndex: i,
        });
      }
      continue;
    }

    const unmapped: Record<string, unknown> = { source: 'chatgpt_export' };
    if (msg.create_time) unmapped.createTime = msg.create_time;
    if (msg.metadata?.model_slug) unmapped.model = msg.metadata.model_slug;

    result.push({ role, content: text, unmappedFields: unmapped });
  }

  return result;
}

// ─── Parse Chat Completions-style message array ─────────────

function parseChatCompletionMessages(
  messages: ChatCompletionMessage[],
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

    // Tool result
    if (role === 'tool') {
      result.push({
        role: '__tool_result__',
        content: JSON.stringify({
          toolName: msg.name ?? 'unknown',
          output: msg.content ?? '',
          callId: msg.tool_call_id ?? `call_${i}`,
          isError: false,
        }),
        unmappedFields: { originalRole: role },
      });
      continue;
    }

    // Modern tool_calls (parallel calls supported)
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (!tc.function || typeof tc.function.name !== 'string') {
          warnings.push({
            type: WarningTypes.UNSUPPORTED_FIELD,
            field: `[${i}].tool_calls`,
            message: `Malformed tool_calls entry at index ${i} (missing function name). Skipped.`,
            messageIndex: i,
          });
          continue;
        }

        let input: unknown = {};
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          warnings.push({
            type: WarningTypes.UNSUPPORTED_FIELD,
            field: `[${i}].tool_calls`,
            message: `Could not parse tool_call arguments as JSON at index ${i}. Preserved as raw string.`,
            messageIndex: i,
          });
          input = { raw: tc.function.arguments };
        }

        result.push({
          role: '__tool_call__',
          content: JSON.stringify({
            toolName: tc.function.name,
            input,
            callId: tc.id ?? `call_${i}`,
          }),
          unmappedFields: { originalRole: role, model: msg.model },
        });
      }

      // An assistant message can carry text alongside tool_calls
      if (msg.content) {
        result.push({ role, content: msg.content, unmappedFields: { model: msg.model } });
      }
      continue;
    }

    // Legacy single function_call
    if (msg.function_call) {
      let input: unknown = {};
      try {
        input = msg.function_call.arguments ? JSON.parse(msg.function_call.arguments) : {};
      } catch {
        input = { raw: msg.function_call.arguments };
      }

      result.push({
        role: '__tool_call__',
        content: JSON.stringify({
          toolName: msg.function_call.name,
          input,
          callId: `call_${i}`,
        }),
        unmappedFields: { originalRole: role, model: msg.model, legacy: 'function_call' },
      });
      continue;
    }

    // Plain text message
    if (typeof msg.content === 'string') {
      if (msg.content.length === 0) {
        warnings.push({
          type: WarningTypes.EMPTY_CONTENT,
          field: `[${i}].content`,
          message: `Empty content at message ${i}.`,
          messageIndex: i,
        });
      }

      const unmapped: Record<string, unknown> = {};
      if (msg.model) {
        unmapped.model = msg.model;
        warnings.push({
          type: WarningTypes.UNSUPPORTED_FIELD,
          field: `[${i}].model`,
          message: `Field "model" preserved in metadata.`,
          messageIndex: i,
        });
      }

      result.push({ role, content: msg.content, unmappedFields: unmapped });
      continue;
    }

    warnings.push({
      type: WarningTypes.SKIPPED_MESSAGE,
      field: `[${i}].content`,
      message: `Message ${i} has no usable content. Skipped.`,
      messageIndex: i,
    });
  }

  return result;
}

// ─── Adapter implementation ─────────────────────────────────

export const chatgptAdapter: Adapter = {
  id: 'chatgpt',
  name: 'ChatGPT (OpenAI)',
  provider: 'openai',
  extensions: ['.json'],

  canParse(raw: string): boolean {
    try {
      return looksLikeChatGPT(JSON.parse(raw));
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
        detectedProvider: 'openai',
      };
    }

    // ChatGPT web export: array of conversations
    if (Array.isArray(parsed) && parsed.some((c) => c && typeof c === 'object' && isExportConversation(c as Record<string, unknown>))) {
      let messages: ParsedMessage[] = [];
      for (const conv of parsed as ExportConversation[]) {
        if (!conv || typeof conv !== 'object' || !isExportConversation(conv as unknown as Record<string, unknown>)) {
          continue;
        }
        messages = messages.concat(parseExportConversation(conv, warnings, messages.length));
      }
      return { messages, format: 'json', warnings, detectedProvider: 'openai' };
    }

    // ChatGPT web export: single conversation object
    if (parsed && typeof parsed === 'object' && isExportConversation(parsed as Record<string, unknown>)) {
      const messages = parseExportConversation(parsed as ExportConversation, warnings, 0);
      return { messages, format: 'json', warnings, detectedProvider: 'openai' };
    }

    // Chat Completions-style array, optionally wrapped as { messages: [...] }
    let messages: ChatCompletionMessage[];

    if (Array.isArray(parsed)) {
      messages = parsed as ChatCompletionMessage[];
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      if (Array.isArray(obj.messages)) {
        messages = obj.messages as ChatCompletionMessage[];

        for (const key of Object.keys(obj)) {
          if (key !== 'messages') {
            warnings.push({
              type: WarningTypes.UNSUPPORTED_FIELD,
              field: key,
              message: `Top-level field "${key}" preserved in import metadata.`,
            });
          }
        }
      } else {
        return {
          messages: [],
          format: 'json',
          warnings: [
            {
              type: WarningTypes.INACCESSIBLE,
              field: 'root',
              message: 'Unrecognized ChatGPT export structure.',
            },
          ],
          detectedProvider: 'openai',
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
        detectedProvider: 'openai',
      };
    }

    return {
      messages: parseChatCompletionMessages(messages, warnings),
      format: 'json',
      warnings,
      detectedProvider: 'openai',
    };
  },
};
