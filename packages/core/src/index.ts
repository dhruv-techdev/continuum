export const VERSION = '0.1.0';
export const PRODUCT_NAME = 'Continuum';
export const DESCRIPTION = 'Verifiable state transfer for AI work';
export const MIN_NODE_VERSION = 18;

export interface CheckResult { name: string; status: 'pass' | 'fail' | 'warn'; message: string; }
export interface ValidationError { field: string; message: string; }

export { DEFAULT_ROOT, WORKSPACE_DIRS, CONFIG_FILENAME, defaultConfig, validateConfig, initWorkspace, loadConfig, isWorkspaceInitialized } from './workspace';
export type { ContinuumConfig, InitResult, LoadConfigResult } from './workspace';

export * from './events/index';
export * from './projects/index';

export { getState, setState, setActiveProject, setActiveSession } from './state';
export type { WorkspaceState } from './state';

export { EventLedger, openLedger } from './ledger/index';
export { verifyLedger, verifySessionLedger, IssueSeverities, IssueCategories } from './ledger/index';
export type { IssueSeverity, IssueCategory, VerificationIssue, VerificationReport, AppendStatus, AppendResult, AppendBatchResult, LedgerReadResult, LedgerStats, IntegrityIssue } from './ledger/index';

export { StatementCategories, ConfidenceLevels, StatementStatuses, VALID_CATEGORIES, extractWorkingState, generateStatementId, generateBootstrap, saveWorkingState, loadWorkingState, listStateHistory, correctStatement, rejectStatement, getActiveStatements, getCorrectionChain } from './state-engine/index';
export type { StatementCategory, ConfidenceLevel, StatementStatus, Statement, WorkingState, BootstrapContext, CorrectionInput, CorrectionResult } from './state-engine/index';

export { ingestRawEvents, ingestFromFile, quickCapture, updateSessionAfterCapture, generateCallId, correlateEvents, findToolResult, findCommandOutput, findToolCall } from './capture/index';
export type { CaptureResult, CaptureError, QuickCaptureInput, ToolPair, CommandPair, CorrelatedPair, CorrelationReport } from './capture/index';

export { generateArtifactId, StorageModes, ArtifactStatuses, detectMimeType, hashFileContent, loadRegistry, saveRegistry, findArtifactByUri, findArtifactById, listArtifacts, registerArtifact, linkEventToArtifact, deleteArtifact } from './artifacts/index';
export type { StorageMode, ArtifactStatus, ArtifactEntry, RegisterArtifactInput, RegisterResult } from './artifacts/index';

export { SCHEMA_VERSION, MetadataDB, openDB, closeDB, closeAllDBs, dbPath, syncProject, syncProjects, syncSession, syncSessions, syncEvent, syncEvents, getWatermark, setWatermark, syncArtifact, syncArtifacts, countEvents, countAllEvents, searchEvents, recoverSession, recoverWorkspace, ensureFTS, extractContent, indexEvent, indexEvents, search, countIndexed, getTimeline, getEventById, getEventsByIds, getDistinctTypes, getDistinctSources, getTimeRange } from './db/index';
export type { RecoveryResult, SearchResult, SearchOptions, TimelineFilter, TimelineEntry, TimelineResult } from './db/index';

export { detectFormat, parseTranscript, parseJSON, parseMarkdown, normalizeToEvents, writeEventsToLedger, importTranscript, WarningTypes } from './import/index';
export type { ParsedMessage, ParseResult, TranscriptFormat, ImportWarning, ImportResult, ImportStats, WarningType, NormalizeInput, NormalizeOutput } from './import/index';
