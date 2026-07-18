import { readFileSync } from 'fs';
import { extname } from 'path';
import { parseJSON } from './json-parser';
import { parseMarkdown } from './markdown-parser';
import type { ParseResult, TranscriptFormat } from './types';

// ─── Format detection ───────────────────────────────────────

export function detectFormat(filePath: string, content: string): TranscriptFormat {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.json' || ext === '.jsonl') return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';

  // Sniff content: if it starts with [ or { it's likely JSON
  const trimmed = content.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json';

  return 'markdown';
}

export function parseTranscript(filePath: string): ParseResult {
  const content = readFileSync(filePath, 'utf-8');
  const format = detectFormat(filePath, content);

  if (format === 'json') {
    return parseJSON(content);
  }

  return parseMarkdown(content);
}

// Re-exports
export { parseJSON } from './json-parser';
export { parseMarkdown } from './markdown-parser';
export { normalizeToEvents, writeEventsToLedger, importTranscript } from './normalizer';

export type {
  ParsedMessage,
  ParseResult,
  TranscriptFormat,
  ImportWarning,
  ImportResult,
  ImportStats,
  WarningType,
} from './types';

export { WarningTypes } from './types';

export type { NormalizeInput, NormalizeOutput } from './normalizer';
