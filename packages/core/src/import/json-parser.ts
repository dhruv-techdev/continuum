/**
 * JSON transcript parser.
 *
 * Handles common export formats:
 *   - Array of messages:  [{ role, content }, ...]
 *   - Wrapped array:      { messages: [...] }
 *   - ChatGPT export:     { mapping: { id: { message: { ... } } } }
 *   - Keyed variants:     { conversation: [...] }, { chat: [...] }
 *
 * Every field beyond role/content is preserved in unmappedFields
 * and reported as a warning so nothing is silently lost.
 */

import type { ParsedMessage, ParseResult, ImportWarning } from './types';
import { WarningTypes } from './types';

const KNOWN_ARRAY_KEYS = ['messages', 'conversation', 'chat', 'data', 'turns'];
const KNOWN_MESSAGE_FIELDS = new Set(['role', 'content']);

function isMessageLike(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.role === 'string' || typeof o.content === 'string';
}

function extractUnmapped(msg: Record<string, unknown>): Record<string, unknown> {
  const unmapped: Record<string, unknown> = {};
  for (const key of Object.keys(msg)) {
    if (!KNOWN_MESSAGE_FIELDS.has(key)) {
      unmapped[key] = msg[key];
    }
  }
  return unmapped;
}

function parseMessageArray(arr: unknown[], warnings: ImportWarning[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];

    if (!isMessageLike(item)) {
      warnings.push({
        type: WarningTypes.SKIPPED_MESSAGE,
        field: `[${i}]`,
        message: `Item at index ${i} is not a recognizable message object. Skipped.`,
        messageIndex: i,
      });
      continue;
    }

    const role = typeof item.role === 'string' ? item.role.toLowerCase().trim() : '';
    const content = typeof item.content === 'string' ? item.content : '';

    if (!role) {
      warnings.push({
        type: WarningTypes.SKIPPED_MESSAGE,
        field: `[${i}].role`,
        message: `Message at index ${i} has no role. Skipped.`,
        messageIndex: i,
      });
      continue;
    }

    if (content.length === 0) {
      warnings.push({
        type: WarningTypes.EMPTY_CONTENT,
        field: `[${i}].content`,
        message: `Message at index ${i} (role: ${role}) has empty content. Imported with empty string.`,
        messageIndex: i,
      });
    }

    const unmapped = extractUnmapped(item);

    for (const key of Object.keys(unmapped)) {
      warnings.push({
        type: WarningTypes.UNSUPPORTED_FIELD,
        field: `[${i}].${key}`,
        message: `Field "${key}" is not mapped to canonical schema. Preserved in metadata.`,
        messageIndex: i,
      });
    }

    messages.push({ role, content, unmappedFields: unmapped });
  }

  return messages;
}

function tryChatGPTMapping(
  data: Record<string, unknown>,
  warnings: ImportWarning[],
): ParsedMessage[] | null {
  if (!data.mapping || typeof data.mapping !== 'object') return null;

  const mapping = data.mapping as Record<string, unknown>;
  const entries: Array<{ sortKey: number; msg: Record<string, unknown> }> = [];

  for (const node of Object.values(mapping)) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (!n.message || typeof n.message !== 'object') continue;

    const msg = n.message as Record<string, unknown>;
    const createTime = typeof msg.create_time === 'number' ? msg.create_time : 0;

    entries.push({ sortKey: createTime, msg });
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => a.sortKey - b.sortKey);

  warnings.push({
    type: WarningTypes.COERCED,
    field: 'mapping',
    message: 'Detected ChatGPT export format. Extracted messages from mapping nodes.',
  });

  const rawArray = entries.map((e) => {
    const m = e.msg;
    const author = m.author as Record<string, unknown> | undefined;
    return {
      role: author?.role ?? m.role ?? '',
      content: extractContentParts(m.content),
      ...extractUnmapped(m),
    };
  });

  return parseMessageArray(rawArray, warnings);
}

function extractContentParts(content: unknown): string {
  if (typeof content === 'string') return content;

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const c = content as Record<string, unknown>;
    if (Array.isArray(c.parts)) {
      return c.parts.filter((p): p is string => typeof p === 'string').join('\n');
    }
  }

  if (Array.isArray(content)) {
    return content.filter((p): p is string => typeof p === 'string').join('\n');
  }

  return '';
}

export function parseJSON(raw: string): ParseResult {
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
      detectedProvider: null,
    };
  }

  // Direct array: [{ role, content }, ...]
  if (Array.isArray(parsed)) {
    return {
      messages: parseMessageArray(parsed, warnings),
      format: 'json',
      warnings,
      detectedProvider: null,
    };
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    // ChatGPT export with mapping
    const chatgpt = tryChatGPTMapping(obj, warnings);
    if (chatgpt) {
      return {
        messages: chatgpt,
        format: 'json',
        warnings,
        detectedProvider: 'openai',
      };
    }

    // Known wrapper keys: messages, conversation, chat, data, turns
    for (const key of KNOWN_ARRAY_KEYS) {
      if (Array.isArray(obj[key])) {
        // Report other top-level fields as unsupported
        for (const topKey of Object.keys(obj)) {
          if (topKey !== key) {
            warnings.push({
              type: WarningTypes.UNSUPPORTED_FIELD,
              field: topKey,
              message: `Top-level field "${topKey}" is not mapped. Preserved in import metadata.`,
            });
          }
        }

        return {
          messages: parseMessageArray(obj[key] as unknown[], warnings),
          format: 'json',
          warnings,
          detectedProvider: null,
        };
      }
    }

    // Unknown structure
    warnings.push({
      type: WarningTypes.INACCESSIBLE,
      field: 'root',
      message: `JSON object has no recognizable message array. Expected one of: ${KNOWN_ARRAY_KEYS.join(', ')}, or a direct array.`,
    });
  }

  return {
    messages: [],
    format: 'json',
    warnings,
    detectedProvider: null,
  };
}
