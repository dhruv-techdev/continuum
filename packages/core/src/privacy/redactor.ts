/**
 * Redaction engine.
 *
 * ST2: Supports three actions for detected secrets:
 *   - REDACT: Replace the secret with a placeholder
 *   - EXCLUDE: Remove the entire event containing the secret
 *   - REFERENCE: Keep a reference to the event but strip content
 */

import { detectSecrets } from './patterns';
import type { SecretDetection } from './patterns';
import type { ContinuumEvent } from '../events/types';

// ─── Actions (ST2) ──────────────────────────────────────────

export const RedactionActions = {
  REDACT: 'redact',
  EXCLUDE: 'exclude',
  REFERENCE: 'reference',
} as const;

export type RedactionAction = (typeof RedactionActions)[keyof typeof RedactionActions];

// ─── Redaction result ───────────────────────────────────────

export interface RedactedEvent {
  event: ContinuumEvent;
  action: RedactionAction;
  detectionsFound: SecretDetection[];
  /** Original content before redaction (only for redact action) */
  originalContent: string | null;
}

export interface RedactionSummary {
  totalEvents: number;
  scannedEvents: number;
  cleanEvents: number;
  redactedEvents: number;
  excludedEvents: number;
  referencedEvents: number;
  totalDetections: number;
  detectionsByType: Record<string, number>;
  detectionsByPattern: Record<string, number>;
}

// ─── Extract scannable text from event ──────────────────────

function getScannableText(event: ContinuumEvent): string {
  const parts: string[] = [];

  switch (event.type) {
    case 'message':
      parts.push(event.payload.content);
      break;
    case 'tool_call':
      parts.push(JSON.stringify(event.payload.input));
      break;
    case 'tool_result':
      parts.push(event.payload.output);
      break;
    case 'command':
      parts.push(event.payload.command);
      break;
    case 'command_output':
      if (event.payload.stdout !== undefined) parts.push(event.payload.stdout);
      if (event.payload.stderr !== undefined) parts.push(event.payload.stderr);
      break;
    case 'artifact':
      parts.push(event.payload.uri);
      if (event.payload.description !== undefined) parts.push(event.payload.description);
      break;
    case 'system':
      if (event.payload.message !== undefined) parts.push(event.payload.message);
      break;
  }

  return parts.join('\n');
}

// ─── Apply redaction to text ────────────────────────────────

const REDACTION_PLACEHOLDER = '[REDACTED]';

function redactText(text: string, detections: SecretDetection[]): string {
  if (detections.length === 0) return text;

  // Apply replacements from end to start to preserve indices
  let result = text;
  const sorted = [...detections].sort((a, b) => b.startIndex - a.startIndex);

  for (const det of sorted) {
    const before = result.slice(0, det.startIndex);
    const after = result.slice(det.endIndex);
    result = before + REDACTION_PLACEHOLDER + after;
  }

  return result;
}

// ─── Apply redaction to an event payload ────────────────────

function redactField(fieldText: string, detections: SecretDetection[], fullText: string): string {
  return redactText(fieldText, recalcIndices(fieldText, detections, fullText));
}

function redactEvent(event: ContinuumEvent, detections: SecretDetection[], fullText: string): ContinuumEvent {
  switch (event.type) {
    case 'message':
      return {
        ...event,
        payload: {
          ...event.payload,
          content: redactField(event.payload.content, detections, fullText),
        },
      };
    case 'tool_call': {
      const inputText = JSON.stringify(event.payload.input);
      return {
        ...event,
        payload: {
          ...event.payload,
          input: JSON.parse(redactField(inputText, detections, fullText)),
        },
      };
    }
    case 'tool_result':
      return {
        ...event,
        payload: {
          ...event.payload,
          output: redactField(event.payload.output, detections, fullText),
        },
      };
    case 'command':
      return {
        ...event,
        payload: {
          ...event.payload,
          command: redactField(event.payload.command, detections, fullText),
        },
      };
    case 'command_output':
      return {
        ...event,
        payload: {
          ...event.payload,
          stdout: event.payload.stdout === undefined
            ? undefined
            : redactField(event.payload.stdout, detections, fullText),
          stderr: event.payload.stderr === undefined
            ? undefined
            : redactField(event.payload.stderr, detections, fullText),
        },
      };
    case 'artifact':
      return {
        ...event,
        payload: {
          ...event.payload,
          uri: redactField(event.payload.uri, detections, fullText),
          description: event.payload.description === undefined
            ? undefined
            : redactField(event.payload.description, detections, fullText),
        },
      };
    case 'system':
      return {
        ...event,
        payload: {
          ...event.payload,
          message: event.payload.message === undefined
            ? undefined
            : redactField(event.payload.message, detections, fullText),
        },
      };
  }
}

function recalcIndices(fieldText: string, detections: SecretDetection[], fullText: string): SecretDetection[] {
  return detections
    .map((d) => {
      const matchText = fullText.slice(d.startIndex, d.endIndex);
      const idx = fieldText.indexOf(matchText);
      if (idx === -1) return null;
      return { ...d, startIndex: idx, endIndex: idx + matchText.length };
    })
    .filter((d): d is SecretDetection => d !== null);
}

// ─── Create a reference-only version of an event ────────────

function createReference(event: ContinuumEvent): ContinuumEvent {
  const reference = {
    _redacted: true,
    _originalType: event.type,
    _reason: 'Secret detected — content removed, reference preserved.',
  };

  switch (event.type) {
    case 'message':
      return { ...event, payload: { role: event.payload.role, content: REDACTION_PLACEHOLDER, ...reference } };
    case 'tool_call':
      return { ...event, payload: { toolName: event.payload.toolName, input: {}, callId: event.payload.callId, ...reference } };
    case 'tool_result':
      return { ...event, payload: { toolName: event.payload.toolName, output: REDACTION_PLACEHOLDER, callId: event.payload.callId, isError: event.payload.isError, ...reference } };
    case 'command':
      return { ...event, payload: { command: REDACTION_PLACEHOLDER, ...reference } };
    case 'command_output':
      return { ...event, payload: { commandEventId: event.payload.commandEventId, stdout: REDACTION_PLACEHOLDER, exitCode: event.payload.exitCode, ...reference } };
    case 'artifact':
      return { ...event, payload: { action: event.payload.action, uri: REDACTION_PLACEHOLDER, mimeType: event.payload.mimeType, hash: event.payload.hash, size: event.payload.size, ...reference } };
    case 'system':
      return { ...event, payload: { action: event.payload.action, message: REDACTION_PLACEHOLDER, ...reference } };
  }
}

// ─── Process events (ST2) ───────────────────────────────────

export interface ProcessOptions {
  /** Default action for detected secrets */
  defaultAction?: RedactionAction;
  /** Per-pattern action overrides */
  patternActions?: Record<string, RedactionAction>;
  /** Per-secret-type action overrides */
  typeActions?: Record<string, RedactionAction>;
  /** Skip high-false-positive patterns */
  skipHighFalsePositive?: boolean;
}

export function processEvents(
  events: ContinuumEvent[],
  options: ProcessOptions = {},
): { events: RedactedEvent[]; summary: RedactionSummary } {
  const defaultAction = options.defaultAction ?? RedactionActions.REDACT;
  const results: RedactedEvent[] = [];

  const summary: RedactionSummary = {
    totalEvents: events.length,
    scannedEvents: 0,
    cleanEvents: 0,
    redactedEvents: 0,
    excludedEvents: 0,
    referencedEvents: 0,
    totalDetections: 0,
    detectionsByType: {},
    detectionsByPattern: {},
  };

  for (const event of events) {
    summary.scannedEvents++;

    const text = getScannableText(event);
    let detections = detectSecrets(text);

    if (options.skipHighFalsePositive) {
      detections = detections.filter((d) => !d.highFalsePositive);
    }

    if (detections.length === 0) {
      summary.cleanEvents++;
      results.push({ event, action: RedactionActions.REDACT, detectionsFound: [], originalContent: null });
      continue;
    }

    summary.totalDetections += detections.length;

    for (const d of detections) {
      summary.detectionsByType[d.type] = (summary.detectionsByType[d.type] ?? 0) + 1;
      summary.detectionsByPattern[d.patternId] = (summary.detectionsByPattern[d.patternId] ?? 0) + 1;
    }

    // Determine action
    let action = defaultAction;

    // Check pattern-specific overrides
    for (const d of detections) {
      if (options.patternActions?.[d.patternId]) {
        action = options.patternActions[d.patternId];
        break;
      }
      if (options.typeActions?.[d.type]) {
        action = options.typeActions[d.type];
        break;
      }
    }

    switch (action) {
      case RedactionActions.REDACT: {
        const redactedEvent = redactEvent(event, detections, text);
        results.push({ event: redactedEvent, action, detectionsFound: detections, originalContent: text });
        summary.redactedEvents++;
        break;
      }

      case RedactionActions.EXCLUDE: {
        // Don't include this event at all
        results.push({ event, action, detectionsFound: detections, originalContent: text });
        summary.excludedEvents++;
        break;
      }

      case RedactionActions.REFERENCE: {
        const refEvent = createReference(event);
        results.push({ event: refEvent, action, detectionsFound: detections, originalContent: text });
        summary.referencedEvents++;
        break;
      }
    }
  }

  return { events: results, summary };
}

/**
 * Get only the clean + redacted events (excludes excluded events).
 */
export function getTransferableEvents(processed: RedactedEvent[]): ContinuumEvent[] {
  return processed
    .filter((r) => r.action !== RedactionActions.EXCLUDE)
    .map((r) => r.event);
}
