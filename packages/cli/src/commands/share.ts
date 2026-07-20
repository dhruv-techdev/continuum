import { Command } from 'commander';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  DEFAULT_ROOT,
  getState,
  getProject,
  exportScopedCapsule,
  RedactionActions,
} from '@continuum/core';
import type { ScopeFilter, ScopedExportResult } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerShareCommand(program: Command): void {
  program
    .command('share')
    .description('Create a scoped, privacy-safe shareable capsule')
    .option('-o, --output <dir>', 'Output directory', join(homedir(), '.continuum', 'capsules'))

    // ST1: Scope filters
    .option('--sessions <ids>', 'Include only these session IDs (comma-separated)')
    .option('--types <types>', 'Include only these event types (comma-separated)')
    .option('--after <timestamp>', 'Include only events after this ISO timestamp')
    .option('--before <timestamp>', 'Include only events before this ISO timestamp')
    .option('--keywords <words>', 'Include only events containing these keywords (comma-separated)')
    .option('--exclude-events <ids>', 'Exclude these event IDs (comma-separated)')

    // ST2: Privacy
    .option('--no-scan', 'Skip the privacy scanner')
    .option('--redact-action <action>', 'Default action for secrets: redact, exclude, reference', 'redact')
    .option('--skip-false-positives', 'Skip high false-positive patterns', false)

    // ST3: Encryption
    .option('--encrypt <passphrase>', 'Encrypt the capsule with a passphrase')

    // Content toggles
    .option('--no-state', 'Exclude working state')
    .option('--no-tracking', 'Exclude decisions/tasks/attempts')
    .option('--include-artifacts', 'Include artifact registry', false)

    // Meta
    .option('--notes <text>', 'Human-readable notes')
    .option('--expires <timestamp>', 'Expiry timestamp')
    .option('--root <path>', '', DEFAULT_ROOT)

    .action((opts) => {
      const projectId = requireProject(opts.root);
      const project = getProject(opts.root, projectId);
      if (!project) { console.error('\n✗ Project not found.\n'); process.exit(1); }

      // Build scope filter (ST1)
      const scope: ScopeFilter = {};
      if (opts.sessions) scope.sessionIds = opts.sessions.split(',').map((s: string) => s.trim());
      if (opts.types) scope.eventTypes = opts.types.split(',').map((s: string) => s.trim());
      if (opts.after) scope.after = opts.after;
      if (opts.before) scope.before = opts.before;
      if (opts.keywords) scope.keywords = opts.keywords.split(',').map((s: string) => s.trim());
      if (opts.excludeEvents) scope.excludeEventIds = opts.excludeEvents.split(',').map((s: string) => s.trim());

      const hasScope = Object.keys(scope).length > 0;

      console.log(`\n  Creating scoped capsule for "${project.title}"...\n`);

      if (hasScope) {
        console.log('  Scope filters:');
        if (scope.sessionIds) console.log(`    Sessions: ${scope.sessionIds.join(', ')}`);
        if (scope.eventTypes) console.log(`    Types:    ${scope.eventTypes.join(', ')}`);
        if (scope.after) console.log(`    After:    ${scope.after}`);
        if (scope.before) console.log(`    Before:   ${scope.before}`);
        if (scope.keywords) console.log(`    Keywords: ${scope.keywords.join(', ')}`);
        if (scope.excludeEventIds) console.log(`    Exclude:  ${scope.excludeEventIds.length} event(s)`);
        console.log('');
      }

      const validActions = Object.values(RedactionActions);
      if (!validActions.includes(opts.redactAction)) {
        console.error(`\n✗ Invalid redact action. Valid: ${validActions.join(', ')}\n`);
        process.exit(1);
      }

      const result = exportScopedCapsule({
        workspaceRoot: opts.root,
        projectId,
        outputDir: opts.output,
        scope: hasScope ? scope : undefined,
        privacy: {
          enabled: opts.scan !== false,
          defaultAction: opts.redactAction,
          skipHighFalsePositive: opts.skipFalsePositives,
        },
        passphrase: opts.encrypt,
        includeState: opts.state !== false,
        includeTracking: opts.tracking !== false,
        includeArtifacts: opts.includeArtifacts,
        notes: opts.notes,
        expiresAt: opts.expires,
      });

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      console.log('✓ Scoped capsule created\n');
      console.log(`  Path:        ${result.capsulePath}`);
      console.log(`  Capsule ID:  ${result.capsuleId}`);
      console.log(`  Events:      ${result.eventsIncluded} included, ${result.eventsExcluded} excluded`);

      if (result.eventsByScope > 0) console.log(`    By scope:  ${result.eventsByScope} filtered out`);
      if (result.eventsByPrivacy > 0) console.log(`    By privacy: ${result.eventsByPrivacy} excluded/removed`);

      if (result.encrypted) {
        console.log(`  Encrypted:   yes (AES-256-GCM)`);
        console.log(`  ⚠ Remember the passphrase — files cannot be recovered without it.`);
      }

      // Privacy report summary
      if (result.redactionReport) {
        const rr = result.redactionReport;
        console.log(`\n  Privacy scan:`);
        console.log(`    Risk level: ${rr.riskLevel}`);
        console.log(`    Secrets:    ${rr.summary.totalDetections} detected`);
        if (rr.summary.redactedEvents > 0) console.log(`    Redacted:   ${rr.summary.redactedEvents} events`);
        if (rr.summary.excludedEvents > 0) console.log(`    Excluded:   ${rr.summary.excludedEvents} events`);
        if (!rr.transferSafe) console.log(`    ⚠ Review the redaction report before sharing.`);
      }

      if (result.manifest.notes) console.log(`\n  Notes: ${result.manifest.notes}`);
      if (result.manifest.expiresAt) console.log(`  Expires: ${result.manifest.expiresAt}`);

      console.log(`\n  To verify: continuum capsule verify ${result.capsulePath}\n`);
    });
}
