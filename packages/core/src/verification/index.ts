export {
  generateCheckId,
  CheckDimensions,
  Criticalities,
  CheckStatuses,
} from './types';

export type {
  CheckDimension,
  Criticality,
  CheckStatus,
  VerificationCheck,
  DimensionScore,
  VerificationReport,
} from './types';

export { generateChecks } from './generator';
export type { GenerateChecksInput } from './generator';

export { scoreCheck, scoreChecks, buildReport } from './scorer';

export {
  saveReport,
  loadLatestReport,
  listReports,
  saveChecks,
  loadPendingChecks,
} from './persistence';

export {
  RepairStatuses,
  identifyFailures,
  identifyCriticalFailures,
  retrieveEvidence,
  buildRepairContext,
  runRepairCycle,
  buildRepairPackage,
} from './repair';

export type {
  RepairStatus,
  RepairItem,
  RepairEvidence,
  RepairReport,
  RepairCycleInput,
} from './repair';
