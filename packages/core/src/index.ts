export const VERSION = '0.1.0';

export const PRODUCT_NAME = 'Continuum';

export const DESCRIPTION = 'Verifiable state transfer for AI work';

export const MIN_NODE_VERSION = 18;

export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

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

export type {
  ContinuumConfig,
  ValidationError,
  InitResult,
  LoadConfigResult,
} from './workspace';
