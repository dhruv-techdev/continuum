export { CAPSULE_SCHEMA_VERSION } from './types';

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
} from './types';

export { buildManifest } from './builder';
export type { BuildManifestInput } from './builder';

export { validateManifest, isCompatibleCapsuleVersion } from './validator';

export { exportCapsule, verifyCapsuleIntegrity } from './exporter';
export type { ExportOptions, ExportResult, VerifyCapsuleResult } from './exporter';

export { importCapsule, ImportPhases } from './importer';
export type {
  ImportPhase,
  ImportIssue,
  CapsuleImportResult,
  CapsuleImportOptions,
} from './importer';
