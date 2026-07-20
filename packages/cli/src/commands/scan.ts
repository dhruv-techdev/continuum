import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  listSessions,
  openLedger,
  processEvents,
  buildRedactionReport,
  RedactionActions,
} from '@continuum/core';
import type { RedactionReport, ContinuumEvent } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function loadAllEvents(root: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(root, projectId);
  const all: ContinuumEvent[] = [];
  for (const s of sessions) all.push(...openLedger(root, projectId, s.id).readAll().events);
  all.sort((a, b) => a.sequence - b.sequence);
  return all;
}

const RISK_ICONS: Record<string, string> = { none: '✓', low: '⚠', medium: '⚠', high: '✗' };

function formatReport(report: RedactionReport, verbose: boolean): string {
  const lines: string[] = [];
  const icon = RISK_ICONS[report.riskLevel] ?? '?';

  lines.push(`\n${icon} Pre-Transfer Security Scan\n`);
  lines.push(`  Risk level:     ${report.riskLevel.toUpperCase()}`);
  lines.push(`  Transfer safe:  ${report.transferSafe ? 'yes' : 'NO'}`);
  lines.push(`\n  Events scanned: ${report.summary.scannedEvents}`);
  lines.push(`  Clean events:   ${report.summary.cleanEvents}`);
  lines.push(`  Total secrets:  ${report.summary.totalDetections}`);

  if (report.summary.redactedEvents > 0) lines.push(`  Redacted:       ${report.summary.redactedEvents} events`);
  if (report.summary.excludedEvents > 0) lines.push(`  Excluded:       ${report.summary.excludedEvents} events`);
  if (report.summary.referencedEvents > 0) lines.push(`  Referenced:     ${report.summary.referencedEvents} events`);

  if (Object.keys(report.summary.detectionsByType).length > 0) {
    lines.push('\n  Detections by type:');
    for (const [type, count] of Object.entries(report.summary.detectionsByType)) {
      lines.push(`    ${type.padEnd(22)} ${count}`);
    }
  }

  if (report.detections.length > 0 && verbose) {
    lines.push(`\n  Detected secrets (${report.detections.length} events):\n`);

    for (const entry of report.detections) {
      lines.push(`    ${entry.eventId} [${entry.eventType}] → ${entry.action}`);
      for (const d of entry.detections) {
        const fp = d.highFalsePositive ? ' (may be false positive)' : '';
        lines.push(`      ${d.label}: ${d.maskedMatch}${fp}`);
      }
      lines.push('');
    }
  } else if (report.detections.length > 0) {
    lines.push(`\n  ${report.detections.length} event(s) contain secrets. Use --verbose to see details.`);
  }

  if (report.recommendations.length > 0) {
    lines.push('\n  Recommendations:');
    for (const r of report.recommendations) {
      lines.push(`    → ${r}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan project events for secrets and sensitive data before transfer')
    .option('--action <action>', 'Default action: redact, exclude, reference', 'redact')
    .option('--skip-false-positives', 'Skip patterns with high false-positive rates', false)
    .option('--verbose', 'Show all detected secrets', false)
    .option('--json', 'Output report as JSON', false)
    .option('-s, --session <id>', 'Scan a specific session')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const events = loadAllEvents(opts.root, projectId);

      if (events.length === 0) {
        console.log('\n  No events to scan.\n');
        return;
      }

      const validActions = Object.values(RedactionActions);
      if (!validActions.includes(opts.action)) {
        console.error(`\n✗ Invalid action "${opts.action}". Valid: ${validActions.join(', ')}\n`);
        process.exit(1);
      }

      const { events: processed, summary } = processEvents(events, {
        defaultAction: opts.action,
        skipHighFalsePositive: opts.skipFalsePositives,
      });

      const report = buildRedactionReport(processed, summary);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(formatReport(report, opts.verbose));

      if (!report.transferSafe) process.exit(1);
    });
}
