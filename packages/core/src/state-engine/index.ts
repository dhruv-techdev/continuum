export {
  StatementCategories,
  ConfidenceLevels,
  StatementStatuses,
  VALID_CATEGORIES,
} from './types';

export type {
  StatementCategory,
  ConfidenceLevel,
  StatementStatus,
  Statement,
  WorkingState,
  BootstrapContext,
  CorrectionInput,
} from './types';

export { extractWorkingState, generateStatementId } from './extractor';
export { generateBootstrap } from './bootstrap';
export { saveWorkingState, loadWorkingState, listStateHistory } from './persistence';

export {
  correctStatement,
  rejectStatement,
  getActiveStatements,
  getCorrectionChain,
} from './corrections';

export type { CorrectionResult } from './corrections';
