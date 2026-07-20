export {
  SecretTypes,
  SECRET_PATTERNS,
  detectSecrets,
} from './patterns';

export type {
  SecretType,
  SecretPattern,
  SecretDetection,
} from './patterns';

export {
  RedactionActions,
  processEvents,
  getTransferableEvents,
} from './redactor';

export type {
  RedactionAction,
  RedactedEvent,
  RedactionSummary,
  ProcessOptions,
} from './redactor';

export { buildRedactionReport } from './report';

export type {
  RedactionReport,
  RedactionReportEntry,
} from './report';
