/**
 * Context capsule manifest specification.
 *
 * A capsule is a portable, versioned package containing
 * everything needed to reconstruct project state in a
 * new session, model, or provider.
 *
 * Directory layout:
 *   project.ctx/
 *     manifest.json          ← this spec
 *     events.jsonl           ← immutable source ledger
 *     state.json             ← derived working state
 *     decisions.json         ← decision tracker
 *     tasks.json             ← task tracker
 *     attempts.json          ← attempt tracker
 *     artifacts/             ← stored file content
 *     artifacts.json         ← artifact registry
 *     evaluations/           ← transfer verification results
 *     integrity.json         ← content hashes for all files
 *
 * ST3: Fields marked (required) must be present for a valid
 * capsule. Fields marked (optional) enrich the capsule but
 * their absence does not block import.
 */

// ─── Capsule schema version (ST1) ───────────────────────────

export const CAPSULE_SCHEMA_VERSION = '1.0.0';

// ─── Manifest (ST1) ─────────────────────────────────────────

export interface CapsuleManifest {
  /** (required) Schema version for forward compatibility */
  schemaVersion: string;
  /** (required) Unique capsule identifier */
  capsuleId: string;
  /** (required) ISO timestamp of capsule creation */
  createdAt: string;
  /** (required) Tool and version that created this capsule */
  createdBy: string;

  /** (required) Project metadata */
  project: CapsuleProjectMeta;

  /** (required) Ledger section — describes the event history */
  ledger: CapsuleLedgerSection;

  /** (optional) Derived working state */
  state: CapsuleStateSection | null;

  /** (optional) Decision, task, and attempt tracking */
  tracking: CapsuleTrackingSection | null;

  /** (optional) Artifact registry and stored files */
  artifacts: CapsuleArtifactSection | null;

  /** (optional) Transfer verification evaluations */
  evaluations: CapsuleEvaluationSection | null;

  /** (required) Integrity manifest for all capsule files */
  integrity: CapsuleIntegritySection;

  /** (optional) Human-readable notes about this capsule */
  notes: string | null;

  /** (optional) Expiry timestamp after which capsule should not be trusted */
  expiresAt: string | null;

  /** (optional) Scoping: which sessions are included */
  sessionFilter: string[] | null;

  /** (optional) Redaction summary */
  redactions: CapsuleRedactionSummary | null;
}

// ─── ST1: Project metadata ──────────────────────────────────

export interface CapsuleProjectMeta {
  /** (required) Project ID */
  id: string;
  /** (required) Project title */
  title: string;
  /** (optional) Project description */
  description: string;
  /** (required) When the project was created */
  createdAt: string;
  /** (required) Session IDs included in this capsule */
  sessionIds: string[];
  /** (required) Total sessions included */
  sessionCount: number;
}

// ─── ST2: Ledger section ────────────────────────────────────

export interface CapsuleLedgerSection {
  /** (required) Relative path to events.jsonl in the capsule */
  path: string;
  /** (required) Total event count */
  eventCount: number;
  /** (required) Event types present */
  eventTypes: string[];
  /** (optional) Earliest event timestamp */
  firstTimestamp: string | null;
  /** (optional) Latest event timestamp */
  lastTimestamp: string | null;
  /** (required) SHA-256 hash of the events.jsonl file */
  fileHash: string;
  /** (required) File size in bytes */
  fileSize: number;
  /** (required) Event schema version used */
  eventSchemaVersion: string;
}

// ─── ST2: State section ─────────────────────────────────────

export interface CapsuleStateSection {
  /** (required) Relative path to state.json */
  path: string;
  /** (required) State version number */
  stateVersion: number;
  /** (required) When state was last extracted */
  extractedAt: string;
  /** (required) Number of active statements */
  activeStatements: number;
  /** (required) Breakdown by category */
  categoryCounts: Record<string, number>;
  /** (required) SHA-256 hash of the state file */
  fileHash: string;
}

// ─── ST2: Tracking section ──────────────────────────────────

export interface CapsuleTrackingSection {
  decisions: CapsuleTrackingFile | null;
  tasks: CapsuleTrackingFile | null;
  attempts: CapsuleTrackingFile | null;
}

export interface CapsuleTrackingFile {
  /** (required) Relative path to the JSON file */
  path: string;
  /** (required) Total entry count */
  count: number;
  /** (required) SHA-256 hash of the file */
  fileHash: string;
}

// ─── ST2: Artifact section ──────────────────────────────────

export interface CapsuleArtifactSection {
  /** (required) Relative path to artifacts.json registry */
  registryPath: string;
  /** (optional) Relative path to artifacts/ directory */
  storagePath: string | null;
  /** (required) Total registered artifacts */
  totalArtifacts: number;
  /** (required) Artifacts with stored content */
  storedCount: number;
  /** (required) Artifacts with reference-only */
  referenceCount: number;
  /** (required) SHA-256 hash of the registry file */
  registryHash: string;
}

// ─── ST2: Evaluation section ────────────────────────────────

export interface CapsuleEvaluationSection {
  /** (required) Relative path to evaluations directory */
  path: string;
  /** (required) Number of evaluation files */
  evaluationCount: number;
  /** (optional) Latest evaluation result summary */
  latestResult: CapsuleEvaluationSummary | null;
}

export interface CapsuleEvaluationSummary {
  /** (required) When the evaluation was run */
  evaluatedAt: string;
  /** (required) Whether all critical checks passed */
  passed: boolean;
  /** (required) Total checks run */
  totalChecks: number;
  /** (required) Checks that passed */
  passedChecks: number;
  /** (required) Checks that failed */
  failedChecks: number;
}

// ─── Integrity section ──────────────────────────────────────

export interface CapsuleFileHash {
  /** Relative path within the capsule */
  path: string;
  /** SHA-256 hash of file content */
  hash: string;
  /** File size in bytes */
  size: number;
}

export interface CapsuleIntegritySection {
  /** (required) Algorithm used for all hashes */
  algorithm: 'sha256';
  /** (required) Per-file hashes */
  files: CapsuleFileHash[];
  /** (required) When integrity was computed */
  computedAt: string;
}

// ─── Redaction summary ──────────────────────────────────────

export interface CapsuleRedactionSummary {
  /** (required) Whether any content was redacted */
  hasRedactions: boolean;
  /** (required) Number of events with redacted content */
  redactedEventCount: number;
  /** (optional) Patterns or types that were redacted */
  redactedPatterns: string[];
}

// ─── Validation result ──────────────────────────────────────

export interface ManifestValidationError {
  field: string;
  message: string;
}
