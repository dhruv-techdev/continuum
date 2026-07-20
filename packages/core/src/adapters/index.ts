export type { Adapter, AdapterRegistry } from './types';

export { claudeAdapter } from './claude';
export { adapterRegistry } from './registry';
export { adapterNormalize } from './normalizer';
export type { AdapterNormalizeInput, AdapterNormalizeOutput } from './normalizer';

export { FieldStatuses, FieldCriticalities, generateCoverageReport } from './coverage';
export type { FieldStatus, FieldCriticality, CoverageField, CoverageReport, CoverageWarning } from './coverage';
