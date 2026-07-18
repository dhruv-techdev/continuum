/**
 * Canonical event schema for Continuum.
 *
 * Every accessible session event is stored as one of these types.
 * The discriminated union ensures compile-time safety: you cannot
 * construct a MessageEvent with an ArtifactPayload.
 */

// ─── Schema version (ST3) ───────────────────────────────────────
// Tracks the event format independently from the product version.
// Bump MAJOR for breaking changes, MINOR for additive fields.

export const EVENT_SCHEMA_VERSION = '1.0.0';

// ─── Event type discriminators (ST2) ────────────────────────────

export const EventTypes = {
  MESSAGE: 'message',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  COMMAND: 'command',
  COMMAND_OUTPUT: 'command_output',
  ARTIFACT: 'artifact',
  SYSTEM: 'system',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export const VALID_EVENT_TYPES: readonly EventType[] = Object.values(EventTypes);

// ─── Shared enums ───────────────────────────────────────────────

export const MessageRoles = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const;

export type MessageRole = (typeof MessageRoles)[keyof typeof MessageRoles];

export const VALID_MESSAGE_ROLES: readonly MessageRole[] = Object.values(MessageRoles);

export const ArtifactActions = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  REFERENCE: 'reference',
} as const;

export type ArtifactAction = (typeof ArtifactActions)[keyof typeof ArtifactActions];

export const VALID_ARTIFACT_ACTIONS: readonly ArtifactAction[] = Object.values(ArtifactActions);

export const SystemActions = {
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  CHECKPOINT: 'checkpoint',
  ERROR: 'error',
  PAUSE: 'pause',
  RESUME: 'resume',
} as const;

export type SystemAction = (typeof SystemActions)[keyof typeof SystemActions];

export const VALID_SYSTEM_ACTIONS: readonly SystemAction[] = Object.values(SystemActions);

// ─── Payloads (ST2) ─────────────────────────────────────────────

export interface MessagePayload {
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallPayload {
  toolName: string;
  input: Record<string, unknown>;
  callId?: string;
}

export interface ToolResultPayload {
  toolName: string;
  output: string;
  callId?: string;
  isError?: boolean;
}

export interface CommandPayload {
  command: string;
  cwd?: string;
  shell?: string;
}

export interface CommandOutputPayload {
  commandEventId: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ArtifactPayload {
  action: ArtifactAction;
  uri: string;
  mimeType?: string;
  hash?: string;
  size?: number;
  description?: string;
}

export interface SystemPayload {
  action: SystemAction;
  message?: string;
  detail?: Record<string, unknown>;
}

// ─── Base event fields (ST1) ────────────────────────────────────

export interface EventBase {
  /** Unique event identifier (evt_<uuid>) */
  id: string;
  /** Project this event belongs to */
  projectId: string;
  /** Session that captured this event */
  sessionId: string;
  /** ISO 8601 UTC timestamp of capture */
  timestamp: string;
  /** Monotonically increasing sequence within the session */
  sequence: number;
  /** Schema version for forward compatibility */
  schemaVersion: string;
  /** SHA-256 hash of canonical content for integrity */
  hash: string;
  /** Adapter or source that produced the event */
  source: string;
}

// ─── Concrete event types (ST2) ─────────────────────────────────

export interface MessageEvent extends EventBase {
  type: typeof EventTypes.MESSAGE;
  payload: MessagePayload;
}

export interface ToolCallEvent extends EventBase {
  type: typeof EventTypes.TOOL_CALL;
  payload: ToolCallPayload;
}

export interface ToolResultEvent extends EventBase {
  type: typeof EventTypes.TOOL_RESULT;
  payload: ToolResultPayload;
}

export interface CommandEvent extends EventBase {
  type: typeof EventTypes.COMMAND;
  payload: CommandPayload;
}

export interface CommandOutputEvent extends EventBase {
  type: typeof EventTypes.COMMAND_OUTPUT;
  payload: CommandOutputPayload;
}

export interface ArtifactEvent extends EventBase {
  type: typeof EventTypes.ARTIFACT;
  payload: ArtifactPayload;
}

export interface SystemEvent extends EventBase {
  type: typeof EventTypes.SYSTEM;
  payload: SystemPayload;
}

// ─── Discriminated union ────────────────────────────────────────

export type ContinuumEvent =
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | CommandEvent
  | CommandOutputEvent
  | ArtifactEvent
  | SystemEvent;

// ─── Type-level maps for generic factory / validation ───────────

export type PayloadMap = {
  [EventTypes.MESSAGE]: MessagePayload;
  [EventTypes.TOOL_CALL]: ToolCallPayload;
  [EventTypes.TOOL_RESULT]: ToolResultPayload;
  [EventTypes.COMMAND]: CommandPayload;
  [EventTypes.COMMAND_OUTPUT]: CommandOutputPayload;
  [EventTypes.ARTIFACT]: ArtifactPayload;
  [EventTypes.SYSTEM]: SystemPayload;
};

export type EventMap = {
  [EventTypes.MESSAGE]: MessageEvent;
  [EventTypes.TOOL_CALL]: ToolCallEvent;
  [EventTypes.TOOL_RESULT]: ToolResultEvent;
  [EventTypes.COMMAND]: CommandEvent;
  [EventTypes.COMMAND_OUTPUT]: CommandOutputEvent;
  [EventTypes.ARTIFACT]: ArtifactEvent;
  [EventTypes.SYSTEM]: SystemEvent;
};

export type PayloadForType<T extends EventType> = PayloadMap[T];
export type EventForType<T extends EventType> = EventMap[T];
