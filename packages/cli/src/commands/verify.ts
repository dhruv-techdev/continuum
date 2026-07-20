import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState, getProject,
  loadWorkingState, extractWorkingState,
  saveWorkingState, openLedger, listSessions,
  loadDecisions, listTasks, listAttempts,
  generateChecks, scoreChecks, buildReport,
  saveReport, loadLatestReport, listReports,
  saveChecks, loadPendingChecks,
  CheckStatuses, Criticalities,
} from '@continuum/core';
import type { VerificationCheck, VerificationReport, ContinuumEvent } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function loadAllEvents(root: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(root, projectId);
  const all: ContinuumEvent[] = [];
  for (const s of sessions) { all.push(...openLedger(root, projectId, s.id).readAll().events); }
  all.sort((a, b) => a.sequence - b.sequence);
  return all;
}

function formatReport(report: VerificationReport): string {
  const lines: string[] = [];
  const icon = report.passed ? '✓' : '✗';
  const verdict = report.passed ? 'PASSED' : 'FAILED';

  lines.push(`\n${icon} Transfer Verification: ${verdict}\n`);
  lines.push(`  Overall:        ${(report.overallScore * 100).toFixed(1)}%`);
  lines.push(`  Correctness:    ${(report.correctness * 100).toFixed(1)}%`);
  lines.push(`  Completeness:   ${(report.completeness * 100).toFixed(1)}%`);
  lines.push(`  Grounding:      ${(report.groundingRate * 100).toFixed(1)}%`);
  lines.push(`  Contradictions: ${report.contradictionCount}`);
  lines.push(`  Critical fails: ${report.criticalFailures}`);
  lines.push(`\n  Checks: ${report.passedChecks}/${report.totalChecks} passed, ${report.failedChecks} failed\n`);

  if (report.dimensionScores.length > 0) {
    lines.push('  Dimensions:\n');
    for (const d of report.dimensionScores) {
      const met = d.met ? '✓' : '✗';
      lines.push(`    ${met} ${d.label.padEnd(24)} ${(d.score * 100).toFixed(0)}% (target: ${(d.target * 100).toFixed(0)}%)  ${d.passedChecks}/${d.totalChecks}`);
    }
    lines.push('');
  }

  const failed = report.checks.filter((c) => c.status === CheckStatuses.FAILED);
  if (failed.length > 0) {
    lines.push(`  Failed checks (${failed.length}):\n`);
    for (const c of failed.slice(0, 10)) {
      const crit = c.criticality === Criticalities.CRITICAL ? ' [CRITICAL]' : '';
      lines.push(`    ✗ ${c.question.slice(0, 80)}…${crit}`);
      lines.push(`      Expected: ${c.expectedAnswer.slice(0, 100)}`);
      if (c.actualAnswer) lines.push(`      Actual:   ${c.actualAnswer.slice(0, 100)}`);
      lines.push(`      Score:    ${c.score?.toFixed(2) ?? '—'}`);
      lines.push('');
    }
    if (failed.length > 10) lines.push(`    ... and ${failed.length - 10} more failed checks.\n`);
  }

  return lines.join('\n');
}

export function registerVerifyCommand(program: Command): void {
  const verify = program.command('verify').description('Transfer verification');

  // ── generate ────────────────────────────────────────────

  verify
    .command('generate')
    .description('Generate verification checks from project state')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);

      let state = loadWorkingState(opts.root, projectId);
      if (!state) {
        const events = loadAllEvents(opts.root, projectId);
        state = extractWorkingState(projectId, events);
        saveWorkingState(opts.root, projectId, state);
      }

      const decisions = loadDecisions(opts.root, projectId);
      const tasks = listTasks(opts.root, projectId);
      const attempts = listAttempts(opts.root, projectId);

      const checks = generateChecks({ state, decisions, tasks, attempts });
      const path = saveChecks(opts.root, projectId, checks);

      console.log(`\n✓ Generated ${checks.length} verification checks\n`);

      const byCrit: Record<string, number> = {};
      const byDim: Record<string, number> = {};
      for (const c of checks) {
        byCrit[c.criticality] = (byCrit[c.criticality] ?? 0) + 1;
        byDim[c.dimension] = (byDim[c.dimension] ?? 0) + 1;
      }

      console.log('  By criticality:');
      for (const [k, v] of Object.entries(byCrit)) console.log(`    ${k.padEnd(12)} ${v}`);

      console.log('\n  By dimension:');
      for (const [k, v] of Object.entries(byDim)) console.log(`    ${k.padEnd(26)} ${v}`);

      console.log(`\n  Saved to: ${path}`);
      console.log('  Next: continuum verify score --answers <file>\n');
    });

  // ── show ────────────────────────────────────────────────

  verify
    .command('show')
    .description('Show pending verification checks')
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const checks = loadPendingChecks(opts.root, projectId);

      if (!checks) {
        console.log('\n  No pending checks. Run "continuum verify generate" first.\n');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(checks, null, 2));
        return;
      }

      console.log(`\n─── Verification Checks (${checks.length})\n`);

      for (let i = 0; i < checks.length; i++) {
        const c = checks[i];
        const crit = c.criticality === Criticalities.CRITICAL ? ' [CRITICAL]' : c.criticality === 'high' ? ' [HIGH]' : '';
        console.log(`  ${i + 1}. [${c.dimension}]${crit}`);
        console.log(`     Q: ${c.question}`);
        console.log(`     A: ${c.expectedAnswer.slice(0, 120)}${c.expectedAnswer.length > 120 ? '…' : ''}`);
        console.log('');
      }
    });

  // ── score ───────────────────────────────────────────────

  verify
    .command('score')
    .description('Score verification checks against provided answers')
    .option('--answers <file>', 'JSON file with answers: { "checkId": "answer", ... }')
    .option('--auto', 'Auto-score using expected answers as actuals (self-test)', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const checks = loadPendingChecks(opts.root, projectId);

      if (!checks) {
        console.log('\n  No pending checks. Run "continuum verify generate" first.\n');
        return;
      }

      const answers = new Map<string, string>();

      if (opts.auto) {
        // Self-test: use expected answers
        for (const c of checks) {
          answers.set(c.id, c.expectedAnswer);
        }
      } else if (opts.answers) {
        const { existsSync, readFileSync } = require('fs');
        if (!existsSync(opts.answers)) {
          console.error(`\n✗ File not found: ${opts.answers}\n`);
          process.exit(1);
        }
        try {
          const parsed = JSON.parse(readFileSync(opts.answers, 'utf-8'));
          for (const [k, v] of Object.entries(parsed)) {
            answers.set(k, v as string);
          }
        } catch {
          console.error('\n✗ Invalid JSON in answers file.\n');
          process.exit(1);
        }
      } else {
        console.error('\n✗ Provide --answers <file> or use --auto for self-test.\n');
        process.exit(1);
      }

      scoreChecks(checks, answers);
      const report = buildReport(projectId, checks);
      const path = saveReport(opts.root, projectId, report);

      console.log(formatReport(report));
      console.log(`  Report saved: ${path}\n`);
    });

  // ── report ──────────────────────────────────────────────

  verify
    .command('report')
    .description('Show the latest verification report')
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const report = loadLatestReport(opts.root, projectId);

      if (!report) {
        console.log('\n  No verification reports. Run "continuum verify generate" then "continuum verify score --auto".\n');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(formatReport(report));
    });

  // ── history ─────────────────────────────────────────────

  verify
    .command('history')
    .description('List verification reports')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const files = listReports(opts.root, projectId);

      if (files.length === 0) {
        console.log('\n  No verification reports.\n');
        return;
      }

      console.log(`\n  Verification Reports (${files.length}):\n`);
      for (const f of files) console.log(`    ${f}`);
      console.log('');
    });
}
