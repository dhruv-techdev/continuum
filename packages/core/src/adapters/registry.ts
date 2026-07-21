import { extname } from 'path';
import type { Adapter, AdapterRegistry } from './types';
import { claudeAdapter } from './claude';
import { claudeCodeAdapter } from './claude-code';
import { chatgptAdapter } from './chatgpt';

// Import the generic parsers as adapters
import { parseJSON } from '../import/json-parser';
import { parseMarkdown } from '../import/markdown-parser';
import type { ParseResult } from '../import/types';

const genericJsonAdapter: Adapter = {
  id: 'generic-json',
  name: 'Generic JSON',
  provider: 'unknown',
  extensions: ['.json', '.jsonl'],
  canParse(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null);
    } catch {
      return false;
    }
  },
  parse(raw: string): ParseResult {
    return parseJSON(raw);
  },
};

const genericMarkdownAdapter: Adapter = {
  id: 'generic-markdown',
  name: 'Generic Markdown',
  provider: 'unknown',
  extensions: ['.md', '.markdown', '.txt'],
  canParse(raw: string): boolean {
    // Check for role markers
    return (
      /^#{1,3}\s+(?:user|assistant|human|system)/im.test(raw) ||
      /^\*\*(?:user|assistant|human|system)\*\*\s*:/im.test(raw) ||
      /^(?:user|assistant|human)\s*:/im.test(raw)
    );
  },
  parse(raw: string): ParseResult {
    return parseMarkdown(raw);
  },
};

// ─── Registry ───────────────────────────────────────────────

function createRegistry(): AdapterRegistry {
  // Order matters: more specific adapters first
  const adapters: Adapter[] = [claudeCodeAdapter, claudeAdapter, chatgptAdapter, genericJsonAdapter, genericMarkdownAdapter];

  return {
    adapters,

    detect(raw: string, filename?: string): Adapter | null {
      // Try provider-specific adapters first (they have stricter canParse)
      for (const adapter of adapters) {
        if (adapter.id === 'generic-json' || adapter.id === 'generic-markdown') continue;

        // Extension hint
        if (filename) {
          const ext = extname(filename).toLowerCase();
          if (adapter.extensions.includes(ext) && adapter.canParse(raw)) {
            return adapter;
          }
        }

        if (adapter.canParse(raw)) return adapter;
      }

      // Fall back to generic adapters
      if (filename) {
        const ext = extname(filename).toLowerCase();
        if (['.md', '.markdown', '.txt'].includes(ext)) {
          return genericMarkdownAdapter;
        }
      }

      // Sniff content
      const trimmed = raw.trimStart();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        return genericJsonAdapter;
      }

      return genericMarkdownAdapter;
    },

    get(id: string): Adapter | null {
      return adapters.find((a) => a.id === id) ?? null;
    },

    list(): string[] {
      return adapters.map((a) => a.id);
    },
  };
}

export const adapterRegistry = createRegistry();
