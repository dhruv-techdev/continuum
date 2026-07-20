import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  getProject,
  getSession,
  listSessions,
  verifySessionLedger,
  IssueSeverities,
} from '@continuum/core';
import type {
  LedgerVerificationReport as VerificationReport,
  VerificationIssue,
} from '@continuum/core';

function requireActiveProject(root: string): string {
  const state = getState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error('  Run "continuum project select <id>" first.\n');
    process.exit(1);
  }
  return state.activeProjectId;
}

function formatIssue(issue: VerificationIssue): string {
  const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ';
  const loc = issue.line > 0 ? `L${issue.line}` : '   ';
  const id = issue.eventId ? ` ${issue.eventId}` : '';
  return `    ${icon} [${issue.category}] ${loc}${id}: ${issue.message}`;
}

function formatReport(report: VerificationReport, verbose: boolean): string {
  const lines: string[] = [];

  const icon = report.passed ? '✓' : '✗';
  const status = report.passed ? 'PASSED' : 'FAILED';
  lines.push(`\n${icon} Ledger verification: ${status}\n`);

  lines.push(`  Events:     ${report.validEvents}/${report.totalEvents} valid`);
  lines.push(`  Lines:      ${report.totalLines}`);
  lines.push(`  Size:       ${formatBytes(report.byteSize)}`);

  if (report.firstTimestamp) {
    lines.push(`  First:      ${report.firstTimestamp}`);
  }
  if (report.lastTimestamp) {
    lines.push(`  Last:       ${report.lastTimestamp}`);
  }

  lines.push(`  Duration:   ${report.durationMs}ms`);

  const errors = report.issues.filter((i) => i.severity === IssueSeverities.ERROR);
  const warnings = report.issues.filter((i) => i.severity === IssueSeverities.WARNING);
  const infos = report.issues.filter((i) => i.severity === IssueSeverities.INFO);

  if (report.issues.length > 0) {
    lines.push('');
    lines.push(
      `  Issues: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`,
    );
    lines.push('');

    const toShow = verbose ? report.issues : report.issues.slice(0, 20);

    for (const issue of toShow) {
      lines.push(formatIssue(issue));
    }

    if (!verbose && report.issues.length > 20) {
      lines.push(`\n    ... and ${report.issues.length - 20} more. Use --verbose to see all.`);
    }
  } else {
    lines.push('\n  No issues found. All events have valid hashes, ordering, and unique IDs.');
  }

  lines.push('');
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerVerifyLedgerCommand(program: Command): void {
  program
    .command('verify-ledger')
    .description('Verify integrity of session event ledger(s)')
    .option('-s, --session <id>', 'Verify a specific session')
    .option('--all', 'Verify all sessions in the active project', false)
    .option('--verbose', 'Show all issues', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const project = getProject(opts.root, projectId);

      if (!project) {
        console.error(`\n✗ Project "${projectId}" not found on disk.\n`);
        process.exit(1);
      }

      console.log(`\nProject: ${project.title} (${project.id})`);

      const sessionIds: string[] = [];

      if (opts.session) {
        sessionIds.push(opts.session);
      } else if (opts.all) {
        const sessions = listSessions(opts.root, projectId);
        for (const s of sessions) {
          sessionIds.push(s.id);
        }
        if (sessionIds.length === 0) {
          console.log('\n  No sessions found in this project.\n');
          return;
        }
      } else {
        // Default: active session
        const state = getState(opts.root);
        if (!state.activeSessionId) {
          console.error('\n✗ No active session. Use --session <id> or --all.\n');
          process.exit(1);
        }
        sessionIds.push(state.activeSessionId);
      }

      let allPassed = true;

      for (const sessionId of sessionIds) {
        const session = getSession(opts.root, projectId, sessionId);
        const label = session ? `${session.provider}/${session.model}` : sessionId;

        console.log(`\n─── Session: ${sessionId} (${label})`);

        const report = verifySessionLedger(opts.root, projectId, sessionId);
        console.log(formatReport(report, opts.verbose));

        if (!report.passed) allPassed = false;
      }

      if (sessionIds.length > 1) {
        const icon = allPassed ? '✓' : '✗';
        console.log(
          `${icon} ${sessionIds.length} session(s) verified. ${allPassed ? 'All passed.' : 'Some failed.'}\n`,
        );
      }

      if (!allPassed) process.exit(1);
    });
}
