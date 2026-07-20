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

export * from './events/index';
export * from './projects/index';

export { getState, setState, setActiveProject, setActiveSession } from './state';
export type { WorkspaceState } from './state';

export { EventLedger, openLedger } from './ledger/index';
export {
  verifyLedger,
  verifySessionLedger,
  IssueSeverities,
  IssueCategories,
} from './ledger/index';
export type {
  IssueSeverity,
  IssueCategory,
  VerificationIssue,
  VerificationReport as LedgerVerificationReport,
  AppendStatus,
  AppendResult,
  AppendBatchResult,
  LedgerReadResult,
  LedgerStats,
  IntegrityIssue,
} from './ledger/index';

export {
  StatementCategories,
  ConfidenceLevels,
  StatementStatuses,
  VALID_CATEGORIES,
  extractWorkingState,
  generateStatementId,
  generateBootstrap,
  saveWorkingState,
  loadWorkingState,
  listStateHistory,
  correctStatement,
  rejectStatement,
  getActiveStatements,
  getCorrectionChain,
} from './state-engine/index';
export type {
  StatementCategory,
  ConfidenceLevel,
  StatementStatus,
  Statement,
  WorkingState,
  BootstrapContext,
  CorrectionInput,
  CorrectionResult,
} from './state-engine/index';

export {
  ingestRawEvents,
  ingestFromFile,
  quickCapture,
  updateSessionAfterCapture,
  generateCallId,
  correlateEvents,
  findToolResult,
  findCommandOutput,
  findToolCall,
} from './capture/index';
export type {
  CaptureResult,
  CaptureError,
  QuickCaptureInput,
  ToolPair,
  CommandPair,
  CorrelatedPair,
  CorrelationReport,
} from './capture/index';

export {
  generateArtifactId,
  StorageModes,
  ArtifactStatuses,
  detectMimeType,
  hashFileContent,
  loadRegistry,
  saveRegistry,
  findArtifactByUri,
  findArtifactById,
  listArtifacts,
  registerArtifact,
  linkEventToArtifact,
  deleteArtifact,
} from './artifacts/index';
export type {
  StorageMode,
  ArtifactStatus,
  ArtifactEntry,
  RegisterArtifactInput,
  RegisterResult,
} from './artifacts/index';

export {
  SCHEMA_VERSION,
  MetadataDB,
  openDB,
  closeDB,
  closeAllDBs,
  dbPath,
  syncProject,
  syncProjects,
  syncSession,
  syncSessions,
  syncEvent,
  syncEvents,
  getWatermark,
  setWatermark,
  syncArtifact,
  syncArtifacts,
  countEvents,
  countAllEvents,
  searchEvents,
  recoverSession,
  recoverWorkspace,
  ensureFTS,
  extractContent,
  indexEvent,
  indexEvents,
  search,
  countIndexed,
  getTimeline,
  getEventById,
  getEventsByIds,
  getDistinctTypes,
  getDistinctSources,
  getTimeRange,
} from './db/index';
export type {
  RecoveryResult,
  SearchResult,
  SearchOptions,
  TimelineFilter,
  TimelineEntry,
  TimelineResult,
} from './db/index';

export {
  DecisionStatuses,
  generateDecisionId,
  loadDecisions,
  createDecision,
  rejectDecision,
  supersedeDecision,
  listDecisions,
  getDecision,
} from './tracking/index';
export type { DecisionStatus, Decision, CreateDecisionInput } from './tracking/index';

export {
  TaskStatuses,
  VALID_TASK_STATUSES,
  generateTaskId,
  loadTasks,
  createTask,
  updateTaskStatus,
  listTasks,
  getTask,
} from './tracking/index';
export type { TaskStatus, Task, CreateTaskInput } from './tracking/index';

export {
  AttemptOutcomes,
  generateAttemptId,
  loadAttempts,
  recordAttempt,
  listAttempts,
  getFailedAttempts,
  getAttempt,
} from './tracking/index';
export type { AttemptOutcome, Attempt, CreateAttemptInput } from './tracking/index';

export {
  CAPSULE_SCHEMA_VERSION,
  buildManifest,
  validateManifest,
  isCompatibleCapsuleVersion,
  exportCapsule,
  verifyCapsuleIntegrity,
  importCapsule,
  ImportPhases,
} from './capsule/index';
export type {
  CapsuleManifest,
  CapsuleProjectMeta,
  CapsuleLedgerSection,
  CapsuleStateSection,
  CapsuleTrackingSection,
  CapsuleTrackingFile,
  CapsuleArtifactSection,
  CapsuleEvaluationSection,
  CapsuleEvaluationSummary,
  CapsuleIntegritySection,
  CapsuleFileHash,
  CapsuleRedactionSummary,
  ManifestValidationError,
  BuildManifestInput,
  ExportOptions,
  ExportResult,
  VerifyCapsuleResult,
  ImportPhase,
  ImportIssue,
  CapsuleImportResult,
  CapsuleImportOptions,
} from './capsule/index';

export {
  ContextLayers,
  ALL_LAYERS,
  estimateTokens,
  trimToTokenBudget,
  buildContextPackage,
  buildSingleLayer,
  MODEL_PRESETS,
  getModelPreset,
  getUsableBudget,
  listPresetIds,
  scoreStatement,
  scoreDecision,
  scoreTask,
  scoreAttempt,
  rankItems,
  selectByBudget,
  deduplicateItems,
  formatDeduplicatedItem,
} from './context/index';
export type {
  ContextLayer,
  LayerContent,
  ContextPackage,
  ContextBuildOptions,
  ModelPreset,
  ScoredItem,
  DeduplicatedItem,
} from './context/index';

export {
  generateCheckId,
  CheckDimensions,
  Criticalities,
  CheckStatuses,
  generateChecks,
  scoreCheck,
  scoreChecks,
  buildReport,
  saveReport,
  loadLatestReport,
  listReports,
  saveChecks,
  loadPendingChecks,
  RepairStatuses,
  identifyFailures,
  identifyCriticalFailures,
  retrieveEvidence,
  buildRepairContext,
  runRepairCycle,
  buildRepairPackage,
} from './verification/index';
export type {
  CheckDimension,
  Criticality,
  CheckStatus,
  VerificationCheck,
  DimensionScore,
  VerificationReport,
  GenerateChecksInput,
  RepairStatus,
  RepairItem,
  RepairEvidence,
  RepairReport,
  RepairCycleInput,
} from './verification/index';

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

// Adapters
export { claudeAdapter, adapterRegistry, adapterNormalize } from './adapters/index';
export type {
  Adapter,
  AdapterRegistry,
  AdapterNormalizeInput,
  AdapterNormalizeOutput,
} from './adapters/index';

// Coverage
export { FieldStatuses, FieldCriticalities, generateCoverageReport } from './adapters/index';
export type { FieldStatus, FieldCriticality, CoverageField, CoverageReport, CoverageWarning } from './adapters/index';
