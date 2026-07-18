export const VERSION = '0.1.0';

export const PRODUCT_NAME = 'Continuum';

export const DESCRIPTION = 'Verifiable state transfer for AI work';

export const MIN_NODE_VERSION = 18;

export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

// Workspace
export {
  DEFAULT_ROOT,
  WORKSPACE_DIRS,
  CONFIG_FILENAME,
  defaultConfig,
  validateConfig,
  initWorkspace,
  loadConfig,
  isWorkspaceInitialized,
} from './workspace';

export type { ContinuumConfig, InitResult, LoadConfigResult } from './workspace';

// Events
export * from './events/index';

// Projects and sessions
export * from './projects/index';

// Workspace state
export { getState, setState, setActiveProject, setActiveSession } from './state';

export type { WorkspaceState } from './state';

// Import
export {
  detectFormat,
  parseTranscript,
  parseJSON,
  parseMarkdown,
  normalizeToEvents,
  writeEventsToLedger,
  importTranscript,
  WarningTypes,
} from './import/index';

export type {
  ParsedMessage,
  ParseResult,
  TranscriptFormat,
  ImportWarning,
  ImportResult,
  ImportStats,
  WarningType,
  NormalizeInput,
  NormalizeOutput,
} from './import/index';
