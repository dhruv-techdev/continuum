import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  readAuditLog,
  getAuditStats,
  AuditOutcomes,
} from '@continuum/core';
import type { AuditEntry, AuditQuery, AuditStats } from '@continuum/core';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatEntry(entry: AuditEntry, verbose: boolean): string {
  const lines: string[] = [];
  const ts = entry.timestamp.slice(0, 19).replace('T', ' ');
  const outcomeIcon = entry.outcome === 'success' ? '✓' : entry.outcome === 'failure' ? '✗' : entry.outcome === 'partial' ? '◐' : '○';
  const dur = formatDuration(entry.durationMs);

  lines.push(`  ${outcomeIcon} ${ts}  ${entry.operation.padEnd(20)} ${dur}`);

  if (entry.projectId) {
    lines.push(`    Project: ${entry.projectId.slice(0, 24)}…`);
  }

  if (entry.error) {
    lines.push(`    Error:   ${entry.error.slice(0, 80)}`);
  }

  if (verbose && Object.keys(entry.details).length > 0) {
    const detailStr = JSON.stringify(entry.details);
    lines.push(`    Details: ${detailStr.slice(0, 100)}${detailStr.length > 100 ? '…' : ''}`);
  }

  return lines.join('\n');
}

function formatStats(stats: AuditStats): string {
  const lines: string[] = [];

  lines.push(`\n─── Audit Statistics\n`);
  lines.push(`  Total entries: ${stats.totalEntries}`);
  lines.push(`  Errors:        ${stats.errorCount}`);

  if (stats.firstEntry && stats.lastEntry) {
    lines.push(`  First:         ${stats.firstEntry.slice(0, 19).replace('T', ' ')}`);
    lines.push(`  Last:          ${stats.lastEntry.slice(0, 19).replace('T', ' ')}`);
  }

  // By outcome
  if (Object.keys(stats.byOutcome).length > 0) {
    lines.push('\n  By outcome:');
    for (const [outcome, count] of Object.entries(stats.byOutcome).sort((a, b) => b[1] - a[1])) {
      const icon = outcome === 'success' ? '✓' : outcome === 'failure' ? '✗' : '○';
      lines.push(`    ${icon} ${outcome.padEnd(12)} ${count}`);
    }
  }

  // By operation
  if (Object.keys(stats.byOperation).length > 0) {
    lines.push('\n  By operation:');
    for (const [op, count] of Object.entries(stats.byOperation).sort((a, b) => b[1] - a[1])) {
      const avg = stats.avgDurationMs[op] ? `  (avg ${formatDuration(stats.avgDurationMs[op])})` : '';
      lines.push(`    ${op.padEnd(22)} ${String(count).padStart(4)}${avg}`);
    }
  }

  // Transfer outcomes
  const t = stats.transferOutcomes;
  if (t.exports + t.imports + t.verifications > 0) {
    lines.push('\n  Transfer activity:');
    if (t.exports > 0) lines.push(`    Exports:       ${t.exports}`);
    if (t.imports > 0) lines.push(`    Imports:       ${t.imports}`);
    if (t.verifications > 0) lines.push(`    Verifications: ${t.verifications}`);
    if (t.repairs > 0) lines.push(`    Repairs:       ${t.repairs}`);
    if (t.scans > 0) lines.push(`    Security scans: ${t.scans}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function registerAuditCommand(program: Command): void {
  const audit = program.command('audit').description('View audit history and system activity log');

  // ── log ─────────────────────────────────────────────────

  audit
    .command('log')
    .description('Show recent audit log entries')
    .option('-n, --limit <count>', 'Number of entries to show', parseInt, 20)
    .option('-o, --operation <op>', 'Filter by operation type')
    .option('--outcome <outcome>', 'Filter by outcome (success, failure, partial, skipped)')
    .option('--errors', 'Show only errors', false)
    .option('--after <timestamp>', 'Entries after this ISO timestamp')
    .option('--before <timestamp>', 'Entries before this ISO timestamp')
    .option('--project', 'Filter to active project only', false)
    .option('--verbose', 'Show operation details', false)
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const query: AuditQuery = {
        limit: opts.limit,
        operation: opts.operation,
        outcome: opts.errors ? AuditOutcomes.FAILURE : opts.outcome,
        after: opts.after,
        before: opts.before,
      };

      if (opts.project) {
        const state = getState(opts.root);
        if (state.activeProjectId) {
          query.projectId = state.activeProjectId;
        }
      }

      const entries = readAuditLog(opts.root, query);

      if (entries.length === 0) {
        console.log('\n  No audit entries found.\n');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      console.log(`\n─── Audit Log (${entries.length} entries)\n`);

      for (const entry of entries) {
        console.log(formatEntry(entry, opts.verbose));
        console.log('');
      }
    });

  // ── stats ───────────────────────────────────────────────

  audit
    .command('stats')
    .description('Show audit statistics and transfer outcomes')
    .option('--project', 'Stats for active project only', false)
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      let projectId: string | undefined;

      if (opts.project) {
        const state = getState(opts.root);
        projectId = state.activeProjectId ?? undefined;
      }

      const stats = getAuditStats(opts.root, projectId);

      if (stats.totalEntries === 0) {
        console.log('\n  No audit entries recorded yet.\n');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(formatStats(stats));
    });

  // ── operations ──────────────────────────────────────────

  audit
    .command('operations')
    .description('List all tracked operation types')
    .action(() => {
      console.log('\n  Tracked Operations:\n');

      const groups: Record<string, string[]> = {
        'Data': ['import', 'export', 'capsule_export', 'capsule_import', 'scoped_export', 'capture', 'search', 'transfer'],
        'Project': ['project_create', 'project_select', 'session_start', 'session_close'],
        'Verification': ['verify_generate', 'verify_score', 'verify_repair', 'ledger_verify'],
        'Privacy': ['redaction_scan', 'redaction_apply'],
        'State': ['state_extract', 'state_regenerate', 'state_correct'],
        'Database': ['db_sync', 'db_reset'],
        'System': ['error'],
      };

      for (const [group, ops] of Object.entries(groups)) {
        console.log(`  ${group}:`);
        for (const op of ops) {
          console.log(`    ${op}`);
        }
        console.log('');
      }

      console.log('  Usage: continuum audit log --operation import\n');
    });
}
