import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  listSessions,
  openLedger,
  generateCoverageReport,
  FieldStatuses,
} from '@continuum/core';
import type { CoverageReport, CoverageField } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

const STATUS_ICONS: Record<string, string> = {
  captured: '✓',
  unsupported: '⚠',
  inaccessible: '✗',
  not_applicable: '—',
};

const CRIT_LABELS: Record<string, string> = {
  critical: 'CRIT',
  important: 'IMP ',
  informational: 'INFO',
};

function formatField(field: CoverageField): string {
  const icon = STATUS_ICONS[field.status] ?? '?';
  const crit = CRIT_LABELS[field.criticality] ?? '    ';
  const count = field.status === FieldStatuses.CAPTURED ? ` (${field.count})` : '';
  return `    ${icon} [${crit}] ${field.label.padEnd(26)} ${field.status}${count}`;
}

function formatReport(report: CoverageReport, verbose: boolean): string {
  const lines: string[] = [];
  const icon = report.transferReady ? '✓' : '✗';

  lines.push(`\n${icon} Capture Coverage Report\n`);
  lines.push(`  Adapter:     ${report.adapterName} (${report.adapterId})`);
  lines.push(`  Provider:    ${report.provider}`);
  lines.push(`\n  Coverage:`);
  lines.push(`    Overall:   ${(report.overallCoverage * 100).toFixed(0)}%  (${report.capturedCount}/${report.totalFields} fields)`);
  lines.push(`    Critical:  ${(report.criticalCoverage * 100).toFixed(0)}%`);
  lines.push(`    Important: ${(report.importantCoverage * 100).toFixed(0)}%`);
  lines.push(`\n  Field status: ${report.capturedCount} captured, ${report.unsupportedCount} unsupported, ${report.inaccessibleCount} inaccessible`);

  // Group by category
  const categories = ['identity', 'content', 'tool', 'metadata', 'artifact', 'system'];

  for (const cat of categories) {
    const catFields = report.fields.filter((f) => f.category === cat);
    const applicable = catFields.filter((f) => f.status !== FieldStatuses.NOT_APPLICABLE);

    if (applicable.length === 0) continue;

    lines.push(`\n  ${cat.charAt(0).toUpperCase() + cat.slice(1)}:`);

    for (const field of applicable) {
      lines.push(formatField(field));
      if (verbose && field.note) {
        lines.push(`         ${field.note}`);
      }
    }
  }

  // Warnings (ST3)
  if (report.warnings.length > 0) {
    lines.push(`\n  Warnings (${report.warnings.length}):\n`);

    const critical = report.warnings.filter((w) => w.severity === 'critical');
    const warning = report.warnings.filter((w) => w.severity === 'warning');

    for (const w of critical) {
      lines.push(`    ✗ [CRITICAL] ${w.message}`);
    }
    for (const w of warning) {
      lines.push(`    ⚠ [WARNING] ${w.message}`);
    }
  }

  lines.push('');

  if (report.transferReady) {
    lines.push('  ✓ Transfer ready: all critical fields captured.\n');
  } else {
    lines.push('  ✗ NOT transfer ready: critical fields missing. Context may be incomplete.\n');
  }

  return lines.join('\n');
}

export function registerCoverageCommand(program: Command): void {
  program
    .command('coverage')
    .description('Report adapter capture coverage for the active project')
    .option('-s, --session <id>', 'Analyze a specific session')
    .option('--verbose', 'Show field notes', false)
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const sessions = listSessions(opts.root, projectId);

      if (sessions.length === 0) {
        console.log('\n  No sessions found. Import a transcript first.\n');
        return;
      }

      const targetSessions = opts.session
        ? sessions.filter((s) => s.id === opts.session)
        : sessions;

      if (targetSessions.length === 0) {
        console.error(`\n✗ Session "${opts.session}" not found.\n`);
        process.exit(1);
      }

      for (const session of targetSessions) {
        const ledger = openLedger(opts.root, projectId, session.id);
        const { events } = ledger.readAll();

        if (events.length === 0) {
          console.log(`\n  Session ${session.id}: no events.\n`);
          continue;
        }

        // Detect adapter from source field
        const sources = [...new Set(events.map((e) => e.source))];
        let adapterId = 'unknown';
        let adapterName = 'Unknown';
        let provider = session.provider;

        for (const src of sources) {
          if (src.includes('claude')) { adapterId = 'claude'; adapterName = 'Claude (Anthropic API)'; provider = 'anthropic'; break; }
          if (src.includes('import:claude')) { adapterId = 'claude'; adapterName = 'Claude (Anthropic API)'; provider = 'anthropic'; break; }
          if (src.includes('generic-json') || src.includes('import:')) { adapterId = 'generic-json'; adapterName = 'Generic JSON'; break; }
          if (src.includes('generic-markdown')) { adapterId = 'generic-markdown'; adapterName = 'Generic Markdown'; break; }
        }

        const report = generateCoverageReport(adapterId, adapterName, provider, events);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        if (targetSessions.length > 1) {
          console.log(`\n─── Session: ${session.id} (${session.provider}/${session.model})`);
        }

        console.log(formatReport(report, opts.verbose));
      }
    });
}
