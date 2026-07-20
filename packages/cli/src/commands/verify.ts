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
  identifyFailures, identifyCriticalFailures,
  buildRepairPackage, runRepairCycle, RepairStatuses,
} from '@continuum/core';
import type { VerificationCheck, VerificationReport, RepairReport, ContinuumEvent } from '@continuum/core';

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

function formatVerificationReport(report: VerificationReport): string {
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
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatRepairReport(report: RepairReport): string {
  const lines: string[] = [];
  const icon = report.verified ? '✓' : '✗';
  const verdict = report.verified ? 'VERIFIED' : 'NOT VERIFIED';

  lines.push(`\n${icon} Transfer Repair: ${verdict}\n`);
  lines.push(`  Passed initially: ${report.passedInitially}`);
  lines.push(`  Repaired:         ${report.repaired}`);
  lines.push(`  Unresolved:       ${report.unresolved}`);
  lines.push(`  Skipped:          ${report.skipped}`);
  lines.push(`  Total:            ${report.totalChecks}`);
  lines.push(`  Cycles run:       ${report.cyclesRun}/${report.maxCycles}\n`);

  if (report.criticalUnresolved.length > 0) {
    lines.push(`  ✗ Critical unresolved (${report.criticalUnresolved.length}):\n`);
    for (const item of report.criticalUnresolved) {
      lines.push(`    ✗ ${item.question.slice(0, 80)}`);
      lines.push(`      Expected: ${item.expectedAnswer.slice(0, 100)}`);
      lines.push(`      ${item.explanation}`);
      lines.push('');
    }
  }

  const repaired = report.items.filter((i) => i.repairStatus === RepairStatuses.REPAIRED);
  if (repaired.length > 0) {
    lines.push(`  ✓ Repaired (${repaired.length}):\n`);
    for (const item of repaired) {
      lines.push(`    ✓ ${item.question.slice(0, 80)}`);
      lines.push(`      ${item.explanation}`);
      lines.push('');
    }
  }

  const unresolvedNonCritical = report.items.filter(
    (i) => i.repairStatus === RepairStatuses.UNRESOLVED && i.criticality !== Criticalities.CRITICAL,
  );
  if (unresolvedNonCritical.length > 0) {
    lines.push(`  ⚠ Unresolved non-critical (${unresolvedNonCritical.length}):\n`);
    for (const item of unresolvedNonCritical.slice(0, 5)) {
      lines.push(`    ⚠ ${item.question.slice(0, 80)}`);
      lines.push(`      ${item.explanation}`);
      lines.push('');
    }
    if (unresolvedNonCritical.length > 5) {
      lines.push(`    ... and ${unresolvedNonCritical.length - 5} more.\n`);
    }
  }

  return lines.join('\n');
}

export function registerVerifyCommand(program: Command): void {
  const verify = program.command('verify').description('Transfer verification and repair');

  // ── generate ────────────────────────────────────────────

  verify.command('generate')
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

      const checks = generateChecks({
        state,
        decisions: loadDecisions(opts.root, projectId),
        tasks: listTasks(opts.root, projectId),
        attempts: listAttempts(opts.root, projectId),
      });

      const path = saveChecks(opts.root, projectId, checks);

      const byCrit: Record<string, number> = {};
      for (const c of checks) byCrit[c.criticality] = (byCrit[c.criticality] ?? 0) + 1;

      console.log(`\n✓ Generated ${checks.length} verification checks\n`);
      console.log('  By criticality:');
      for (const [k, v] of Object.entries(byCrit)) console.log(`    ${k.padEnd(12)} ${v}`);
      console.log(`\n  Saved: ${path}\n`);
    });

  // ── show ────────────────────────────────────────────────

  verify.command('show')
    .description('Show pending verification checks')
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const checks = loadPendingChecks(opts.root, projectId);

      if (!checks) { console.log('\n  No pending checks. Run "continuum verify generate" first.\n'); return; }

      if (opts.json) { console.log(JSON.stringify(checks, null, 2)); return; }

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

  verify.command('score')
    .description('Score verification checks')
    .option('--answers <file>', 'JSON file: { "checkId": "answer", ... }')
    .option('--auto', 'Self-test with expected answers', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const checks = loadPendingChecks(opts.root, projectId);
      if (!checks) { console.log('\n  No pending checks.\n'); return; }

      const answers = new Map<string, string>();
      if (opts.auto) {
        for (const c of checks) answers.set(c.id, c.expectedAnswer);
      } else if (opts.answers) {
        const { existsSync, readFileSync } = require('fs');
        if (!existsSync(opts.answers)) { console.error(`\n✗ Not found: ${opts.answers}\n`); process.exit(1); }
        const parsed = JSON.parse(readFileSync(opts.answers, 'utf-8'));
        for (const [k, v] of Object.entries(parsed)) answers.set(k, v as string);
      } else {
        console.error('\n✗ Provide --answers <file> or --auto.\n'); process.exit(1);
      }

      scoreChecks(checks, answers);
      const report = buildReport(projectId, checks);
      const path = saveReport(opts.root, projectId, report);

      console.log(formatVerificationReport(report));
      console.log(`  Report saved: ${path}\n`);
    });

  // ── repair (ST1 + ST2 + ST3) ────────────────────────────

  verify.command('repair')
    .description('Generate repair evidence for failed checks and re-score')
    .option('--answers <file>', 'JSON file with repaired answers')
    .option('--auto', 'Auto-repair using expected answers (self-test)', false)
    .option('--show-evidence', 'Show the repair evidence package', false)
    .option('--max-cycles <n>', 'Max repair cycles', parseInt, 3)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const report = loadLatestReport(opts.root, projectId);

      if (!report) {
        console.error('\n✗ No verification report found. Run "continuum verify generate" and "continuum verify score" first.\n');
        process.exit(1);
      }

      // ST1: Identify failures
      const failures = identifyFailures(report);

      if (failures.length === 0) {
        console.log('\n✓ No repairs needed — all checks passed.\n');
        return;
      }

      console.log(`\n  Found ${failures.length} failed/incomplete check(s).`);

      const criticalFailures = identifyCriticalFailures(report);
      if (criticalFailures.length > 0) {
        console.log(`  ${criticalFailures.length} are CRITICAL.\n`);
      }

      // ST2: Build repair evidence package
      if (opts.showEvidence) {
        const repairPackage = buildRepairPackage(opts.root, projectId, report);
        console.log(repairPackage);
        return;
      }

      // ST3: Re-score with repaired answers
      const repairedAnswers = new Map<string, string>();

      if (opts.auto) {
        for (const check of failures) {
          repairedAnswers.set(check.id, check.expectedAnswer);
        }
      } else if (opts.answers) {
        const { existsSync, readFileSync } = require('fs');
        if (!existsSync(opts.answers)) { console.error(`\n✗ Not found: ${opts.answers}\n`); process.exit(1); }
        const parsed = JSON.parse(readFileSync(opts.answers, 'utf-8'));
        for (const [k, v] of Object.entries(parsed)) repairedAnswers.set(k, v as string);
      } else {
        // No answers — just show the evidence package
        const repairPackage = buildRepairPackage(opts.root, projectId, report);
        console.log(repairPackage);
        return;
      }

      const repairReport = runRepairCycle({
        workspaceRoot: opts.root,
        projectId,
        report,
        repairedAnswers,
        maxCycles: opts.maxCycles,
      });

      console.log(formatRepairReport(repairReport));

      // Save the updated report
      const updatedChecks = report.checks.map((check) => {
        const item = repairReport.items.find((i) => i.checkId === check.id);
        if (item && item.repairStatus === RepairStatuses.REPAIRED && item.repairedScore !== null) {
          return {
            ...check,
            status: CheckStatuses.PASSED,
            actualAnswer: repairedAnswers.get(check.id) ?? check.actualAnswer,
            score: item.repairedScore,
            explanation: item.explanation,
          };
        }
        return check;
      });

      const updatedReport = buildReport(projectId, updatedChecks);
      const path = saveReport(opts.root, projectId, updatedReport);
      console.log(`  Updated report saved: ${path}\n`);
    });

  // ── report ──────────────────────────────────────────────

  verify.command('report')
    .description('Show the latest verification report')
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const report = loadLatestReport(opts.root, projectId);
      if (!report) { console.log('\n  No reports. Run "continuum verify generate" then "verify score".\n'); return; }
      if (opts.json) { console.log(JSON.stringify(report, null, 2)); return; }
      console.log(formatVerificationReport(report));
    });

  // ── history ─────────────────────────────────────────────

  verify.command('history')
    .description('List verification reports')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const files = listReports(opts.root, projectId);
      if (files.length === 0) { console.log('\n  No reports.\n'); return; }
      console.log(`\n  Reports (${files.length}):\n`);
      for (const f of files) console.log(`    ${f}`);
      console.log('');
    });
}
