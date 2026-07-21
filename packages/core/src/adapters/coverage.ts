/**
 * Adapter capture coverage reporting.
 *
 * ST1: Defines field statuses — captured, unsupported, inaccessible
 * ST2: Generates a coverage report after ingestion
 * ST3: Warns before transfer when critical info is unavailable
 */

// ─── ST1: Field statuses ────────────────────────────────────

export const FieldStatuses = {
  /** Field was successfully captured and mapped */
  CAPTURED: 'captured',
  /** Field exists in the source but is not mapped to canonical schema */
  UNSUPPORTED: 'unsupported',
  /** Field is known to exist in this provider's format but was not present */
  INACCESSIBLE: 'inaccessible',
  /** Field is not applicable to this provider */
  NOT_APPLICABLE: 'not_applicable',
} as const;

export type FieldStatus = (typeof FieldStatuses)[keyof typeof FieldStatuses];

// ─── Field criticality ─────────────────────────────────────

export const FieldCriticalities = {
  CRITICAL: 'critical',
  IMPORTANT: 'important',
  INFORMATIONAL: 'informational',
} as const;

export type FieldCriticality = (typeof FieldCriticalities)[keyof typeof FieldCriticalities];

// ─── Coverage field ─────────────────────────────────────────

export interface CoverageField {
  /** Canonical field name */
  name: string;
  /** Human-readable label */
  label: string;
  /** What category this field belongs to */
  category: 'identity' | 'content' | 'tool' | 'metadata' | 'artifact' | 'system';
  /** How critical this field is for transfer */
  criticality: FieldCriticality;
  /** Current status after ingestion */
  status: FieldStatus;
  /** Number of events that had this field */
  count: number;
  /** Explanation of the status */
  note: string;
}

// ─── Coverage report (ST2) ──────────────────────────────────

export interface CoverageReport {
  adapterId: string;
  adapterName: string;
  provider: string;
  generatedAt: string;

  fields: CoverageField[];

  /** Summary counts */
  totalFields: number;
  capturedCount: number;
  unsupportedCount: number;
  inaccessibleCount: number;

  /** Coverage percentages */
  overallCoverage: number;
  criticalCoverage: number;
  importantCoverage: number;

  /** ST3: Warnings for missing critical info */
  warnings: CoverageWarning[];

  /** Whether this adapter meets minimum transfer requirements */
  transferReady: boolean;
}

export interface CoverageWarning {
  severity: 'critical' | 'warning' | 'info';
  field: string;
  message: string;
}

// ─── Canonical fields definition ────────────────────────────

const CANONICAL_FIELDS: Array<Omit<CoverageField, 'status' | 'count' | 'note'>> = [
  // Identity
  { name: 'event_id', label: 'Event ID', category: 'identity', criticality: FieldCriticalities.CRITICAL },
  { name: 'project_id', label: 'Project ID', category: 'identity', criticality: FieldCriticalities.CRITICAL },
  { name: 'session_id', label: 'Session ID', category: 'identity', criticality: FieldCriticalities.CRITICAL },
  { name: 'timestamp', label: 'Timestamp', category: 'identity', criticality: FieldCriticalities.CRITICAL },
  { name: 'sequence', label: 'Sequence Number', category: 'identity', criticality: FieldCriticalities.CRITICAL },
  { name: 'hash', label: 'Content Hash', category: 'identity', criticality: FieldCriticalities.IMPORTANT },

  // Content
  { name: 'message_role', label: 'Message Role', category: 'content', criticality: FieldCriticalities.CRITICAL },
  { name: 'message_content', label: 'Message Content', category: 'content', criticality: FieldCriticalities.CRITICAL },
  { name: 'message_metadata', label: 'Message Metadata', category: 'content', criticality: FieldCriticalities.INFORMATIONAL },

  // Tool
  { name: 'tool_name', label: 'Tool Name', category: 'tool', criticality: FieldCriticalities.IMPORTANT },
  { name: 'tool_input', label: 'Tool Input', category: 'tool', criticality: FieldCriticalities.IMPORTANT },
  { name: 'tool_output', label: 'Tool Output', category: 'tool', criticality: FieldCriticalities.IMPORTANT },
  { name: 'tool_call_id', label: 'Tool Call ID (correlation)', category: 'tool', criticality: FieldCriticalities.IMPORTANT },
  { name: 'tool_is_error', label: 'Tool Error Flag', category: 'tool', criticality: FieldCriticalities.INFORMATIONAL },

  // Metadata
  { name: 'source', label: 'Event Source', category: 'metadata', criticality: FieldCriticalities.IMPORTANT },
  { name: 'schema_version', label: 'Schema Version', category: 'metadata', criticality: FieldCriticalities.IMPORTANT },
  { name: 'provider_model', label: 'Provider Model', category: 'metadata', criticality: FieldCriticalities.INFORMATIONAL },
  { name: 'stop_reason', label: 'Stop Reason', category: 'metadata', criticality: FieldCriticalities.INFORMATIONAL },
  { name: 'usage_stats', label: 'Token Usage Stats', category: 'metadata', criticality: FieldCriticalities.INFORMATIONAL },

  // Artifact
  { name: 'artifact_uri', label: 'Artifact URI', category: 'artifact', criticality: FieldCriticalities.INFORMATIONAL },
  { name: 'artifact_mime', label: 'Artifact MIME Type', category: 'artifact', criticality: FieldCriticalities.INFORMATIONAL },
  { name: 'artifact_hash', label: 'Artifact Content Hash', category: 'artifact', criticality: FieldCriticalities.INFORMATIONAL },

  // System
  { name: 'system_action', label: 'System Action', category: 'system', criticality: FieldCriticalities.INFORMATIONAL },
  { name: 'command', label: 'Shell Command', category: 'system', criticality: FieldCriticalities.INFORMATIONAL },
  { name: 'exit_code', label: 'Command Exit Code', category: 'system', criticality: FieldCriticalities.INFORMATIONAL },
];

// ─── ST2: Analyze events and build coverage report ──────────

import type { ContinuumEvent } from '../events/types';
import type { ImportWarning } from '../import/types';

interface FieldCounter {
  captured: number;
  unsupported: Set<string>;
}

function analyzeEvents(events: ContinuumEvent[]): Map<string, FieldCounter> {
  const counters = new Map<string, FieldCounter>();

  for (const field of CANONICAL_FIELDS) {
    counters.set(field.name, { captured: 0, unsupported: new Set() });
  }

  for (const event of events) {
    // Identity fields — always present in valid events
    counters.get('event_id')!.captured++;
    counters.get('project_id')!.captured++;
    counters.get('session_id')!.captured++;
    counters.get('timestamp')!.captured++;
    counters.get('sequence')!.captured++;
    counters.get('hash')!.captured++;
    counters.get('source')!.captured++;
    counters.get('schema_version')!.captured++;

    switch (event.type) {
      case 'message':
        if (event.payload.role) counters.get('message_role')!.captured++;
        if (event.payload.content !== undefined) counters.get('message_content')!.captured++;
        if (event.payload.metadata) {
          counters.get('message_metadata')!.captured++;
          const meta = event.payload.metadata;
          if (meta.model || meta.detectedProvider) counters.get('provider_model')!.captured++;
          if (meta.originalFields) {
            const orig = meta.originalFields as Record<string, unknown>;
            if (orig.stop_reason) counters.get('stop_reason')!.captured++;
            if (orig.usage) counters.get('usage_stats')!.captured++;

            // Track unsupported fields
            for (const key of Object.keys(orig)) {
              if (!['model', 'stop_reason', 'usage', 'blockIndex'].includes(key)) {
                counters.get('message_metadata')!.unsupported.add(key);
              }
            }
          }
        }
        break;

      case 'tool_call':
        if (event.payload.toolName) counters.get('tool_name')!.captured++;
        if (event.payload.input) counters.get('tool_input')!.captured++;
        if (event.payload.callId) counters.get('tool_call_id')!.captured++;
        break;

      case 'tool_result':
        if (event.payload.toolName) counters.get('tool_name')!.captured++;
        if (event.payload.output !== undefined) counters.get('tool_output')!.captured++;
        if (event.payload.callId) counters.get('tool_call_id')!.captured++;
        if (event.payload.isError !== undefined) counters.get('tool_is_error')!.captured++;
        break;

      case 'artifact':
        if (event.payload.uri) counters.get('artifact_uri')!.captured++;
        if (event.payload.mimeType) counters.get('artifact_mime')!.captured++;
        if (event.payload.hash) counters.get('artifact_hash')!.captured++;
        break;

      case 'system':
        if (event.payload.action) counters.get('system_action')!.captured++;
        break;

      case 'command':
        if (event.payload.command) counters.get('command')!.captured++;
        break;

      case 'command_output':
        if (event.payload.exitCode !== undefined) counters.get('exit_code')!.captured++;
        break;
    }
  }

  return counters;
}

function resolveFieldStatus(
  field: Omit<CoverageField, 'status' | 'count' | 'note'>,
  counter: FieldCounter,
  totalEvents: number,
  hasToolEvents: boolean,
  hasArtifactEvents: boolean,
  hasSystemEvents: boolean,
  parseWarnings: ImportWarning[],
): CoverageField {
  // Not applicable if no events of this type exist
  if (field.category === 'tool' && !hasToolEvents) {
    return { ...field, status: FieldStatuses.NOT_APPLICABLE, count: 0, note: 'No tool events in this import.' };
  }
  if (field.category === 'artifact' && !hasArtifactEvents) {
    return { ...field, status: FieldStatuses.NOT_APPLICABLE, count: 0, note: 'No artifact events in this import.' };
  }
  if (field.category === 'system' && !hasSystemEvents && field.name !== 'source' && field.name !== 'schema_version') {
    return { ...field, status: FieldStatuses.NOT_APPLICABLE, count: 0, note: 'No system/command events in this import.' };
  }

  if (counter.captured > 0) {
    const unsupportedList = [...counter.unsupported];
    const note = unsupportedList.length > 0
      ? `Captured ${counter.captured}/${totalEvents}. Unmapped sub-fields: ${unsupportedList.join(', ')}`
      : `Captured ${counter.captured}/${totalEvents}.`;

    return { ...field, status: FieldStatuses.CAPTURED, count: counter.captured, note };
  }

  // Check if there were warnings about this field
  const fieldWarnings = parseWarnings.filter(
    (w) => w.type === 'unsupported_field' && w.field.includes(field.name),
  );

  if (fieldWarnings.length > 0) {
    return {
      ...field,
      status: FieldStatuses.UNSUPPORTED,
      count: 0,
      note: `Present in source but not mapped: ${fieldWarnings[0].message}`,
    };
  }

  // Check if any provider-specific warning mentions inaccessibility
  const inaccessibleWarnings = parseWarnings.filter(
    (w) => w.type === 'inaccessible',
  );

  if (inaccessibleWarnings.length > 0 && field.criticality === FieldCriticalities.CRITICAL) {
    return {
      ...field,
      status: FieldStatuses.INACCESSIBLE,
      count: 0,
      note: 'Not accessible from the source format.',
    };
  }

  return {
    ...field,
    status: FieldStatuses.INACCESSIBLE,
    count: 0,
    note: 'Not found in any imported event.',
  };
}

export function generateCoverageReport(
  adapterId: string,
  adapterName: string,
  provider: string,
  events: ContinuumEvent[],
  parseWarnings: ImportWarning[] = [],
): CoverageReport {
  const counters = analyzeEvents(events);

  const hasToolEvents = events.some((e) => e.type === 'tool_call' || e.type === 'tool_result');
  const hasArtifactEvents = events.some((e) => e.type === 'artifact');
  const hasSystemEvents = events.some((e) => e.type === 'system' || e.type === 'command' || e.type === 'command_output');

  const fields: CoverageField[] = CANONICAL_FIELDS.map((field) => {
    const counter = counters.get(field.name) ?? { captured: 0, unsupported: new Set() };
    return resolveFieldStatus(field, counter, events.length, hasToolEvents, hasArtifactEvents, hasSystemEvents, parseWarnings);
  });

  // Filter out not-applicable for counting
  const applicable = fields.filter((f) => f.status !== FieldStatuses.NOT_APPLICABLE);
  const captured = applicable.filter((f) => f.status === FieldStatuses.CAPTURED);
  const unsupported = applicable.filter((f) => f.status === FieldStatuses.UNSUPPORTED);
  const inaccessible = applicable.filter((f) => f.status === FieldStatuses.INACCESSIBLE);

  const critical = applicable.filter((f) => f.criticality === FieldCriticalities.CRITICAL);
  const criticalCaptured = critical.filter((f) => f.status === FieldStatuses.CAPTURED);

  const important = applicable.filter((f) => f.criticality === FieldCriticalities.IMPORTANT);
  const importantCaptured = important.filter((f) => f.status === FieldStatuses.CAPTURED);

  const overallCoverage = applicable.length > 0 ? captured.length / applicable.length : 0;
  const criticalCoverage = critical.length > 0 ? criticalCaptured.length / critical.length : 1;
  const importantCoverage = important.length > 0 ? importantCaptured.length / important.length : 1;

  // ST3: Generate warnings
  const warnings: CoverageWarning[] = [];

  for (const field of applicable) {
    if (field.status === FieldStatuses.INACCESSIBLE && field.criticality === FieldCriticalities.CRITICAL) {
      warnings.push({
        severity: 'critical',
        field: field.name,
        message: `Critical field "${field.label}" was not captured. Transfer may be incomplete.`,
      });
    } else if (field.status === FieldStatuses.UNSUPPORTED && field.criticality === FieldCriticalities.CRITICAL) {
      warnings.push({
        severity: 'critical',
        field: field.name,
        message: `Critical field "${field.label}" exists in source but is not mapped. Data may be lost.`,
      });
    } else if (field.status === FieldStatuses.INACCESSIBLE && field.criticality === FieldCriticalities.IMPORTANT) {
      warnings.push({
        severity: 'warning',
        field: field.name,
        message: `Important field "${field.label}" was not captured. Context may be reduced.`,
      });
    } else if (field.status === FieldStatuses.UNSUPPORTED && field.criticality === FieldCriticalities.IMPORTANT) {
      warnings.push({
        severity: 'warning',
        field: field.name,
        message: `Important field "${field.label}" exists but is not mapped.`,
      });
    }
  }

  const transferReady = criticalCoverage >= 1.0 && warnings.filter((w) => w.severity === 'critical').length === 0;

  return {
    adapterId,
    adapterName,
    provider,
    generatedAt: new Date().toISOString(),
    fields,
    totalFields: applicable.length,
    capturedCount: captured.length,
    unsupportedCount: unsupported.length,
    inaccessibleCount: inaccessible.length,
    overallCoverage,
    criticalCoverage,
    importantCoverage,
    warnings,
    transferReady,
  };
}
