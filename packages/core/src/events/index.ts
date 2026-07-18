// Types and constants
export {
  EVENT_SCHEMA_VERSION,
  EventTypes,
  VALID_EVENT_TYPES,
  MessageRoles,
  VALID_MESSAGE_ROLES,
  ArtifactActions,
  VALID_ARTIFACT_ACTIONS,
  SystemActions,
  VALID_SYSTEM_ACTIONS,
} from './types';

export type {
  EventType,
  MessageRole,
  ArtifactAction,
  SystemAction,
  MessagePayload,
  ToolCallPayload,
  ToolResultPayload,
  CommandPayload,
  CommandOutputPayload,
  ArtifactPayload,
  SystemPayload,
  EventBase,
  MessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  CommandEvent,
  CommandOutputEvent,
  ArtifactEvent,
  SystemEvent,
  ContinuumEvent,
  PayloadForType,
  EventForType,
} from './types';

// Hashing
export { canonicalize, computeEventHash, verifyEventHash } from './hash';

// Factory
export { createEvent, generateEventId } from './factory';
export type { CreateEventInput } from './factory';

// Validation
export { validateEvent, isValidEventType, isCompatibleSchemaVersion } from './validation';
