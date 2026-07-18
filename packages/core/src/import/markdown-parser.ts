/**
 * Markdown transcript parser.
 *
 * Recognizes common patterns people use when copying AI conversations:
 *
 *   ## User / ## Assistant          (heading style)
 *   **User:** / **Assistant:**      (bold-prefix style)
 *   User: / Assistant:              (plain-prefix style)
 *   Human: / Assistant:             (Claude-style)
 *   > **User:** ...                 (blockquote style)
 *
 * The parser scans line by line for role markers, then collects
 * all subsequent lines as that role's content until the next marker.
 */

import type { ParsedMessage, ParseResult, ImportWarning } from './types';
import { WarningTypes } from './types';

// ─── Role detection ─────────────────────────────────────────

interface RoleMatch {
  role: string;
  /** Number of characters consumed by the marker (the rest is content) */
  markerLength: number;
}

const ROLE_ALIASES: Record<string, string> = {
  user: 'user',
  human: 'user',
  me: 'user',
  assistant: 'assistant',
  ai: 'assistant',
  bot: 'assistant',
  chatgpt: 'assistant',
  claude: 'assistant',
  gpt: 'assistant',
  system: 'system',
};

function normalizeRole(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  return ROLE_ALIASES[lower] ?? null;
}

/**
 * Try to extract a role marker from the start of a line.
 * Returns null if the line is not a role marker.
 */
function matchRoleLine(line: string): RoleMatch | null {
  const trimmed = line.trim();

  // ## User / ## Assistant (with optional colon/dash after)
  const headingMatch = trimmed.match(/^#{1,3}\s+(\w+)\s*[:：\-—]?\s*$/);
  if (headingMatch) {
    const role = normalizeRole(headingMatch[1]);
    if (role) return { role, markerLength: trimmed.length };
  }

  // **User:** / **Assistant:** (bold prefix, content may follow on same line)
  const boldMatch = trimmed.match(/^\*\*(\w+)\s*[:：]?\s*\*\*\s*[:：]?\s*(.*)/);
  if (boldMatch) {
    const role = normalizeRole(boldMatch[1]);
    if (role) {
      const contentStart = trimmed.length - boldMatch[2].length;
      return { role, markerLength: contentStart };
    }
  }

  // > **User:** ... (blockquote bold)
  const bqBoldMatch = trimmed.match(/^>\s*\*\*(\w+)\s*[:：]?\s*\*\*\s*[:：]?\s*(.*)/);
  if (bqBoldMatch) {
    const role = normalizeRole(bqBoldMatch[1]);
    if (role) {
      const contentStart = trimmed.length - bqBoldMatch[2].length;
      return { role, markerLength: contentStart };
    }
  }

  // User: / Assistant: / Human: (plain prefix, only if the single word maps to a known role)
  const plainMatch = trimmed.match(/^(\w+)\s*[:：]\s*(.*)/);
  if (plainMatch) {
    const role = normalizeRole(plainMatch[1]);
    if (role) {
      // Avoid false positives: only match if this is the entire prefix
      // (e.g., "Note:" should not match, "User:" should)
      const contentStart = trimmed.length - plainMatch[2].length;
      return { role, markerLength: contentStart };
    }
  }

  return null;
}

// ─── Parser ─────────────────────────────────────────────────

export function parseMarkdown(raw: string): ParseResult {
  const warnings: ImportWarning[] = [];
  const messages: ParsedMessage[] = [];

  const lines = raw.split(/\r?\n/);

  let currentRole: string | null = null;
  let currentLines: string[] = [];
  let messageIndex = 0;

  function flushCurrent() {
    if (currentRole === null) return;

    const content = currentLines.join('\n').trim();

    if (content.length === 0) {
      warnings.push({
        type: WarningTypes.EMPTY_CONTENT,
        field: `message[${messageIndex}].content`,
        message: `Message ${messageIndex} (role: ${currentRole}) has empty content.`,
        messageIndex,
      });
    }

    messages.push({
      role: currentRole,
      content,
      unmappedFields: {},
    });

    messageIndex++;
    currentRole = null;
    currentLines = [];
  }

  // Track lines before first role marker
  let prefixLineCount = 0;
  let foundFirstMarker = false;

  for (const line of lines) {
    const match = matchRoleLine(line);

    if (match) {
      if (!foundFirstMarker && prefixLineCount > 0) {
        const prefixContent = lines.slice(0, prefixLineCount).join('\n').trim();
        if (prefixContent.length > 0) {
          warnings.push({
            type: WarningTypes.SKIPPED_MESSAGE,
            field: 'preamble',
            message: `${prefixLineCount} line(s) before first role marker were skipped.`,
          });
        }
      }
      foundFirstMarker = true;

      flushCurrent();
      currentRole = match.role;

      // If the marker line had trailing content (bold-prefix style)
      const trailing = line.trim().slice(match.markerLength).trim();
      if (trailing.length > 0) {
        currentLines.push(trailing);
      }
    } else {
      if (foundFirstMarker) {
        currentLines.push(line);
      } else {
        prefixLineCount++;
      }
    }
  }

  flushCurrent();

  if (messages.length === 0 && raw.trim().length > 0) {
    warnings.push({
      type: WarningTypes.INACCESSIBLE,
      field: 'root',
      message: 'No role markers found. The file may not be a recognized transcript format.',
    });
  }

  return {
    messages,
    format: 'markdown',
    warnings,
    detectedProvider: null,
  };
}
