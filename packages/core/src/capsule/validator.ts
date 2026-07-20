/**
 * Validate a capsule manifest against the specification.
 *
 * ST3: Documents required vs optional fields by checking
 * presence and type of every required field.
 */

import { CAPSULE_SCHEMA_VERSION } from './types';
import type { ManifestValidationError } from './types';

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function validateManifest(manifest: unknown): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!isObject(manifest)) {
    return [{ field: 'manifest', message: 'Must be a non-null object.' }];
  }

  const m = manifest as Record<string, unknown>;

  // ── Required top-level fields (ST1) ─────────────────────

  if (!isNonEmptyString(m.schemaVersion) || !SEMVER.test(m.schemaVersion as string)) {
    errors.push({ field: 'schemaVersion', message: 'Must be a valid semver string.' });
  } else {
    const major = parseInt((m.schemaVersion as string).split('.')[0], 10);
    const currentMajor = parseInt(CAPSULE_SCHEMA_VERSION.split('.')[0], 10);
    if (major !== currentMajor) {
      errors.push({
        field: 'schemaVersion',
        message: `Incompatible major version. Expected ${currentMajor}.x.x.`,
      });
    }
  }

  if (!isNonEmptyString(m.capsuleId)) {
    errors.push({ field: 'capsuleId', message: 'Required. Must be a non-empty string.' });
  }

  if (!isNonEmptyString(m.createdAt) || !ISO_TS.test(m.createdAt as string)) {
    errors.push({ field: 'createdAt', message: 'Required. Must be a valid ISO 8601 timestamp.' });
  }

  if (!isNonEmptyString(m.createdBy)) {
    errors.push({ field: 'createdBy', message: 'Required. Must identify the creating tool.' });
  }

  // ── Project section (required, ST1) ─────────────────────

  if (!isObject(m.project)) {
    errors.push({ field: 'project', message: 'Required. Must be an object.' });
  } else {
    const p = m.project as Record<string, unknown>;

    if (!isNonEmptyString(p.id)) errors.push({ field: 'project.id', message: 'Required.' });
    if (!isNonEmptyString(p.title)) errors.push({ field: 'project.title', message: 'Required.' });
    if (!isNonEmptyString(p.createdAt))
      errors.push({ field: 'project.createdAt', message: 'Required.' });
    if (!Array.isArray(p.sessionIds))
      errors.push({ field: 'project.sessionIds', message: 'Required. Must be an array.' });
    if (typeof p.sessionCount !== 'number')
      errors.push({ field: 'project.sessionCount', message: 'Required. Must be a number.' });
  }

  // ── Ledger section (required, ST2) ──────────────────────

  if (!isObject(m.ledger)) {
    errors.push({ field: 'ledger', message: 'Required. Must be an object.' });
  } else {
    const l = m.ledger as Record<string, unknown>;

    if (!isNonEmptyString(l.path)) errors.push({ field: 'ledger.path', message: 'Required.' });
    if (typeof l.eventCount !== 'number')
      errors.push({ field: 'ledger.eventCount', message: 'Required. Must be a number.' });
    if (!Array.isArray(l.eventTypes))
      errors.push({ field: 'ledger.eventTypes', message: 'Required. Must be an array.' });
    if (!isNonEmptyString(l.fileHash))
      errors.push({ field: 'ledger.fileHash', message: 'Required. Must be a SHA-256 hex string.' });
    if (typeof l.fileSize !== 'number')
      errors.push({ field: 'ledger.fileSize', message: 'Required. Must be a number.' });
    if (!isNonEmptyString(l.eventSchemaVersion))
      errors.push({ field: 'ledger.eventSchemaVersion', message: 'Required.' });
  }

  // ── Integrity section (required) ────────────────────────

  if (!isObject(m.integrity)) {
    errors.push({ field: 'integrity', message: 'Required. Must be an object.' });
  } else {
    const i = m.integrity as Record<string, unknown>;

    if (i.algorithm !== 'sha256')
      errors.push({ field: 'integrity.algorithm', message: 'Must be "sha256".' });
    if (!Array.isArray(i.files))
      errors.push({ field: 'integrity.files', message: 'Required. Must be an array.' });
    if (!isNonEmptyString(i.computedAt))
      errors.push({ field: 'integrity.computedAt', message: 'Required.' });

    if (Array.isArray(i.files)) {
      for (let idx = 0; idx < (i.files as unknown[]).length; idx++) {
        const f = (i.files as unknown[])[idx];
        if (!isObject(f)) {
          errors.push({ field: `integrity.files[${idx}]`, message: 'Must be an object.' });
          continue;
        }
        const file = f as Record<string, unknown>;
        if (!isNonEmptyString(file.path))
          errors.push({ field: `integrity.files[${idx}].path`, message: 'Required.' });
        if (!isNonEmptyString(file.hash))
          errors.push({ field: `integrity.files[${idx}].hash`, message: 'Required.' });
        if (typeof file.size !== 'number')
          errors.push({ field: `integrity.files[${idx}].size`, message: 'Required.' });
      }
    }
  }

  // ── Optional sections: type-check if present (ST2) ──────

  if (m.state !== null && m.state !== undefined) {
    if (!isObject(m.state)) {
      errors.push({ field: 'state', message: 'Must be an object or null.' });
    } else {
      const s = m.state as Record<string, unknown>;
      if (!isNonEmptyString(s.path))
        errors.push({ field: 'state.path', message: 'Required when state is present.' });
      if (typeof s.stateVersion !== 'number')
        errors.push({ field: 'state.stateVersion', message: 'Required when state is present.' });
      if (typeof s.activeStatements !== 'number')
        errors.push({
          field: 'state.activeStatements',
          message: 'Required when state is present.',
        });
      if (!isNonEmptyString(s.fileHash))
        errors.push({ field: 'state.fileHash', message: 'Required when state is present.' });
    }
  }

  if (m.tracking !== null && m.tracking !== undefined) {
    if (!isObject(m.tracking)) {
      errors.push({ field: 'tracking', message: 'Must be an object or null.' });
    }
  }

  if (m.artifacts !== null && m.artifacts !== undefined) {
    if (!isObject(m.artifacts)) {
      errors.push({ field: 'artifacts', message: 'Must be an object or null.' });
    } else {
      const a = m.artifacts as Record<string, unknown>;
      if (!isNonEmptyString(a.registryPath))
        errors.push({
          field: 'artifacts.registryPath',
          message: 'Required when artifacts is present.',
        });
      if (typeof a.totalArtifacts !== 'number')
        errors.push({
          field: 'artifacts.totalArtifacts',
          message: 'Required when artifacts is present.',
        });
      if (!isNonEmptyString(a.registryHash))
        errors.push({
          field: 'artifacts.registryHash',
          message: 'Required when artifacts is present.',
        });
    }
  }

  return errors;
}

/**
 * Check schema version compatibility.
 */
export function isCompatibleCapsuleVersion(version: string): boolean {
  if (!SEMVER.test(version)) return false;
  const major = parseInt(version.split('.')[0], 10);
  const currentMajor = parseInt(CAPSULE_SCHEMA_VERSION.split('.')[0], 10);
  return major === currentMajor;
}
