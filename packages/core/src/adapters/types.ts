/**
 * Adapter interface.
 *
 * Every capture adapter implements the same contract:
 * take raw provider-specific data and produce ParseResult
 * (the intermediate representation from the import pipeline).
 */

import type { ParseResult } from '../import/types';

export interface Adapter {
  /** Unique adapter identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider this adapter handles */
  provider: string;
  /** File extensions this adapter can handle */
  extensions: string[];
  /** Check whether the raw content looks like this adapter's format */
  canParse(raw: string): boolean;
  /** Parse the raw content into the intermediate representation */
  parse(raw: string): ParseResult;
}

export interface AdapterRegistry {
  adapters: Adapter[];
  /** Auto-detect the best adapter for a given file */
  detect(raw: string, filename?: string): Adapter | null;
  /** Get adapter by ID */
  get(id: string): Adapter | null;
  /** List all registered adapter IDs */
  list(): string[];
}
