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
