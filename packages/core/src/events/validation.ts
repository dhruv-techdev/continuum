/**
 * Runtime validation for untrusted event data.
 *
 * Used when importing capsules, reading JSONL from disk, or
 * receiving events from external adapters. The factory handles
 * trusted creation; this module handles everything else.
 */

import {
  VALID_EVENT_TYPES,
  VALID_MESSAGE_ROLES,
  VALID_ARTIFACT_ACTIONS,
  VALID_SYSTEM_ACTIONS,
  EVENT_SCHEMA_VERSION,
} from './types';
import { verifyEventHash } from './hash';
import type { EventType, ValidationError } from '../index';

// ─── Helpers ────────────────────────────────────────────────────

const EVENT_ID_PATTERN = /^evt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!ISO_8601_UTC_PATTERN.test(value)) return false;
  return !isNaN(Date.parse(value));
}

export function isValidEventType(type: unknown): type is EventType {
  return typeof type === 'string' && VALID_EVENT_TYPES.includes(type as EventType);
}

/**
 * Check whether an event's schema version is compatible with the
 * current reader. Compatible means same major version.
 */
export function isCompatibleSchemaVersion(version: string): boolean {
  if (!SEMVER_PATTERN.test(version)) return false;
  const eventMajor = parseInt(version.split('.')[0], 10);
  const currentMajor = parseInt(EVENT_SCHEMA_VERSION.split('.')[0], 10);
  return eventMajor === currentMajor;
}

// ─── Base field validation ──────────────────────────────────────

function validateBaseFields(event: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof event.id !== 'string' || !EVENT_ID_PATTERN.test(event.id)) {
    errors.push({ field: 'id', message: 'Must match format "evt_<uuid>".' });
  }

  if (!isNonEmptyString(event.projectId)) {
    errors.push({ field: 'projectId', message: 'Must be a non-empty string.' });
  }

  if (!isNonEmptyString(event.sessionId)) {
    errors.push({ field: 'sessionId', message: 'Must be a non-empty string.' });
  }

  if (!isValidTimestamp(event.timestamp)) {
    errors.push({ field: 'timestamp', message: 'Must be a valid ISO 8601 UTC string (ending in Z).' });
  }

  if (typeof event.sequence !== 'number' || !Number.isInteger(event.sequence) || event.sequence < 0) {
    errors.push({ field: 'sequence', message: 'Must be a non-negative integer.' });
  }

  if (!isNonEmptyString(event.schemaVersion) || !SEMVER_PATTERN.test(event.schemaVersion as string)) {
    errors.push({ field: 'schemaVersion', message: 'Must be a valid semver string.' });
  } else if (!isCompatibleSchemaVersion(event.schemaVersion as string)) {
    errors.push({
      field: 'schemaVersion',
      message: `Incompatible major version. Current reader supports ${EVENT_SCHEMA_VERSION}.`,
    });
  }

  if (typeof event.hash !== 'string' || !SHA256_PATTERN.test(event.hash)) {
    errors.push({ field: 'hash', message: 'Must be a 64-character lowercase hex string (SHA-256).' });
  }

  if (!isNonEmptyString(event.source)) {
    errors.push({ field: 'source', message: 'Must be a non-empty string.' });
  }

  if (!isValidEventType(event.type)) {
    errors.push({ field: 'type', message: `Must be one of: ${VALID_EVENT_TYPES.join(', ')}.` });
  }

  return errors;
}

// ─── Payload validation per type ────────────────────────────────

function validateMessagePayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!VALID_MESSAGE_ROLES.includes(payload.role as never)) {
    errors.push({ field: 'payload.role', message: `Must be one of: ${VALID_MESSAGE_ROLES.join(', ')}.` });
  }

  if (typeof payload.content !== 'string') {
    errors.push({ field: 'payload.content', message: 'Must be a string.' });
  }

  if (payload.metadata !== undefined && !isObject(payload.metadata)) {
    errors.push({ field: 'payload.metadata', message: 'Must be an object if provided.' });
  }

  return errors;
}

function validateToolCallPayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(payload.toolName)) {
    errors.push({ field: 'payload.toolName', message: 'Must be a non-empty string.' });
  }

  if (!isObject(payload.input)) {
    errors.push({ field: 'payload.input', message: 'Must be an object.' });
  }

  if (payload.callId !== undefined && typeof payload.callId !== 'string') {
    errors.push({ field: 'payload.callId', message: 'Must be a string if provided.' });
  }

  return errors;
}

function validateToolResultPayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(payload.toolName)) {
    errors.push({ field: 'payload.toolName', message: 'Must be a non-empty string.' });
  }

  if (typeof payload.output !== 'string') {
    errors.push({ field: 'payload.output', message: 'Must be a string.' });
  }

  if (payload.callId !== undefined && typeof payload.callId !== 'string') {
    errors.push({ field: 'payload.callId', message: 'Must be a string if provided.' });
  }

  if (payload.isError !== undefined && typeof payload.isError !== 'boolean') {
    errors.push({ field: 'payload.isError', message: 'Must be a boolean if provided.' });
  }

  return errors;
}

function validateCommandPayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(payload.command)) {
    errors.push({ field: 'payload.command', message: 'Must be a non-empty string.' });
  }

  if (payload.cwd !== undefined && typeof payload.cwd !== 'string') {
    errors.push({ field: 'payload.cwd', message: 'Must be a string if provided.' });
  }

  if (payload.shell !== undefined && typeof payload.shell !== 'string') {
    errors.push({ field: 'payload.shell', message: 'Must be a string if provided.' });
  }

  return errors;
}

function validateCommandOutputPayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(payload.commandEventId)) {
    errors.push({ field: 'payload.commandEventId', message: 'Must be a non-empty string.' });
  }

  if (payload.stdout !== undefined && typeof payload.stdout !== 'string') {
    errors.push({ field: 'payload.stdout', message: 'Must be a string if provided.' });
  }

  if (payload.stderr !== undefined && typeof payload.stderr !== 'string') {
    errors.push({ field: 'payload.stderr', message: 'Must be a string if provided.' });
  }

  if (payload.exitCode !== undefined) {
    if (typeof payload.exitCode !== 'number' || !Number.isInteger(payload.exitCode)) {
      errors.push({ field: 'payload.exitCode', message: 'Must be an integer if provided.' });
    }
  }

  return errors;
}

function validateArtifactPayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!VALID_ARTIFACT_ACTIONS.includes(payload.action as never)) {
    errors.push({ field: 'payload.action', message: `Must be one of: ${VALID_ARTIFACT_ACTIONS.join(', ')}.` });
  }

  if (!isNonEmptyString(payload.uri)) {
    errors.push({ field: 'payload.uri', message: 'Must be a non-empty string.' });
  }

  if (payload.mimeType !== undefined && typeof payload.mimeType !== 'string') {
    errors.push({ field: 'payload.mimeType', message: 'Must be a string if provided.' });
  }

  if (payload.hash !== undefined && typeof payload.hash !== 'string') {
    errors.push({ field: 'payload.hash', message: 'Must be a string if provided.' });
  }

  if (payload.size !== undefined && (typeof payload.size !== 'number' || payload.size < 0)) {
    errors.push({ field: 'payload.size', message: 'Must be a non-negative number if provided.' });
  }

  if (payload.description !== undefined && typeof payload.description !== 'string') {
    errors.push({ field: 'payload.description', message: 'Must be a string if provided.' });
  }

  return errors;
}

function validateSystemPayload(payload: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!VALID_SYSTEM_ACTIONS.includes(payload.action as never)) {
    errors.push({ field: 'payload.action', message: `Must be one of: ${VALID_SYSTEM_ACTIONS.join(', ')}.` });
  }

  if (payload.message !== undefined && typeof payload.message !== 'string') {
    errors.push({ field: 'payload.message', message: 'Must be a string if provided.' });
  }

  if (payload.detail !== undefined && !isObject(payload.detail)) {
    errors.push({ field: 'payload.detail', message: 'Must be an object if provided.' });
  }

  return errors;
}

const PAYLOAD_VALIDATORS: Record<string, (p: Record<string, unknown>) => ValidationError[]> = {
  message: validateMessagePayload,
  tool_call: validateToolCallPayload,
  tool_result: validateToolResultPayload,
  command: validateCommandPayload,
  command_output: validateCommandOutputPayload,
  artifact: validateArtifactPayload,
  system: validateSystemPayload,
};

// ─── Full event validation ──────────────────────────────────────

/**
 * Validate an untrusted event object at runtime.
 *
 * Checks base fields, payload shape for the declared type,
 * schema version compatibility, and content hash integrity.
 */
export function validateEvent(event: unknown): ValidationError[] {
  if (!isObject(event)) {
    return [{ field: 'event', message: 'Must be a non-null object.' }];
  }

  const errors = validateBaseFields(event);

  // Payload presence
  if (!isObject(event.payload)) {
    errors.push({ field: 'payload', message: 'Must be a non-null object.' });
  } else if (isValidEventType(event.type)) {
    const payloadValidator = PAYLOAD_VALIDATORS[event.type];
    if (payloadValidator) {
      errors.push(...payloadValidator(event.payload as Record<string, unknown>));
    }
  }

  // Hash integrity (only if base fields are well-formed enough to compute)
  if (
    errors.length === 0 &&
    typeof event.hash === 'string' &&
    SHA256_PATTERN.test(event.hash)
  ) {
    if (!verifyEventHash(event as Parameters<typeof verifyEventHash>[0])) {
      errors.push({ field: 'hash', message: 'Content hash does not match. Event may have been modified.' });
    }
  }

  return errors;
}
