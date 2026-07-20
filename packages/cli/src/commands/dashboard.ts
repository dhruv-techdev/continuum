import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  buildDashboard,
  VERSION,
} from '@continuum/core';
import type { DashboardSnapshot } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function bar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function trunc(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatDashboard(d: DashboardSnapshot): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────
  lines.push('');
  lines.push(`  ╔${'═'.repeat(58)}╗`);
  lines.push(`  ║  Continuum v${VERSION.padEnd(44)}║`);
  lines.push(`  ║  ${d.project.title.padEnd(55)}║`);
  if (d.project.description) {
    lines.push(`  ║  ${trunc(d.project.description, 55).padEnd(55)}║`);
  }
  lines.push(`  ╚${'═'.repeat(58)}╝`);

  // ── ST1: Project overview ───────────────────────────────
  lines.push('');
  lines.push('  ─── Overview ───────────────────────────────────────────');
  lines.push('');
  lines.push(`  Sessions:  ${d.sessions.total} total  (${d.sessions.active} active, ${d.sessions.closed} closed)`);
  lines.push(`  Events:    ${d.events.total} captured`);

  if (d.events.firstTimestamp && d.events.lastTimestamp) {
    const first = d.events.firstTimestamp.slice(0, 19).replace('T', ' ');
    const last = d.events.lastTimestamp.slice(0, 19).replace('T', ' ');
    lines.push(`  Timespan:  ${first} → ${last}`);
  }

  // Event type breakdown
  if (Object.keys(d.events.byType).length > 0) {
    lines.push('');
    lines.push('  Events by type:');
    const maxCount = Math.max(...Object.values(d.events.byType));
    for (const [type, count] of Object.entries(d.events.byType).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${type.padEnd(16)} ${bar(count, maxCount, 15)} ${count}`);
    }
  }

  // Sessions list
  if (d.sessions.list.length > 0) {
    lines.push('');
    lines.push('  Sessions:');
    for (const s of d.sessions.list) {
      const icon = s.status === 'active' ? '●' : '○';
      lines.push(`    ${icon} ${s.id.slice(0, 20)}…  ${s.provider}/${s.model}  ${s.eventCount} events`);
    }
  }

  // ── ST2: Working state ──────────────────────────────────
  lines.push('');
  lines.push('  ─── Working State ──────────────────────────────────────');
  lines.push('');

  if (!d.state.available) {
    lines.push('  ⚠ No working state extracted. Run: continuum state show --refresh');
  } else {
    lines.push(`  Active statements: ${d.state.totalStatements}`);

    if (d.state.objectives.length > 0) {
      lines.push('');
      lines.push('  Objectives:');
      for (const o of d.state.objectives.slice(0, 3)) {
        lines.push(`    🎯 ${trunc(o)}`);
      }
    }

    if (d.state.nextActions.length > 0) {
      lines.push('');
      lines.push('  Next actions:');
      for (const n of d.state.nextActions.slice(0, 3)) {
        lines.push(`    → ${trunc(n)}`);
      }
    }

    if (d.state.openQuestions.length > 0) {
      lines.push('');
      lines.push('  Open questions:');
      for (const q of d.state.openQuestions.slice(0, 3)) {
        lines.push(`    ? ${trunc(q)}`);
      }
    }
  }

  // Tasks
  if (d.tasks.total > 0) {
    lines.push('');
    lines.push(`  Tasks: ${d.tasks.total} total`);

    const taskBar = [
      { label: 'completed', count: d.tasks.completed, icon: '✓' },
      { label: 'active', count: d.tasks.active, icon: '◐' },
      { label: 'pending', count: d.tasks.pending, icon: '○' },
      { label: 'blocked', count: d.tasks.blocked, icon: '✗' },
    ];

    for (const t of taskBar) {
      if (t.count > 0) {
        lines.push(`    ${t.icon} ${t.label.padEnd(12)} ${bar(t.count, d.tasks.total, 15)} ${t.count}`);
      }
    }

    if (d.tasks.blockedItems.length > 0) {
      lines.push('');
      lines.push('  Blocked:');
      for (const b of d.tasks.blockedItems) {
        lines.push(`    ✗ ${trunc(b.description, 40)}: ${trunc(b.reason, 30)}`);
      }
    }
  }

  // Decisions
  if (d.decisions.total > 0) {
    lines.push('');
    lines.push(`  Decisions: ${d.decisions.active} active, ${d.decisions.rejected} rejected, ${d.decisions.superseded} superseded`);

    for (const dec of d.decisions.recentDecisions.slice(-3)) {
      lines.push(`    ● ${trunc(dec.choice)}`);
    }
  }

  // Attempts
  if (d.attempts.total > 0) {
    lines.push('');
    lines.push(`  Attempts: ${d.attempts.successes} successes, ${d.attempts.failures} failures`);

    if (d.attempts.recentFailures.length > 0) {
      lines.push('  Recent failures (avoid repeating):');
      for (const f of d.attempts.recentFailures) {
        lines.push(`    ✗ ${trunc(f.approach, 35)}: ${trunc(f.reason, 30)}`);
      }
    }
  }

  // Artifacts
  if (d.artifacts.total > 0) {
    lines.push('');
    lines.push(`  Artifacts: ${d.artifacts.total} registered (${d.artifacts.stored} stored, ${d.artifacts.referenced} refs)`);
  }

  // ── ST3: Verification ───────────────────────────────────
  lines.push('');
  lines.push('  ─── Transfer Verification ──────────────────────────────');
  lines.push('');

  if (d.verification.reportCount === 0) {
    lines.push('  No verification reports. Run: continuum verify generate && continuum verify score --auto');
  } else if (d.verification.latestReport) {
    const v = d.verification.latestReport;
    const icon = v.passed ? '✓' : '✗';
    const verdict = v.passed ? 'PASSED' : 'FAILED';

    lines.push(`  ${icon} Latest: ${verdict}  (${d.verification.reportCount} report(s) total)`);
    lines.push('');
    lines.push(`    Overall:      ${bar(v.overallScore, 1, 20)} ${pct(v.overallScore)}`);
    lines.push(`    Correctness:  ${bar(v.correctness, 1, 20)} ${pct(v.correctness)}`);
    lines.push(`    Completeness: ${bar(v.completeness, 1, 20)} ${pct(v.completeness)}`);
    lines.push(`    Checks:       ${v.passedChecks}/${v.totalChecks} passed, ${v.failedChecks} failed`);

    if (v.criticalFailures > 0) {
      lines.push(`    ✗ ${v.criticalFailures} CRITICAL failure(s)`);
    }
  }

  // ── Footer ──────────────────────────────────────────────
  lines.push('');
  lines.push(`  ─── Commands ───────────────────────────────────────────`);
  lines.push('');
  lines.push('  continuum state show          View full working state');
  lines.push('  continuum timeline            Browse event history');
  lines.push('  continuum search <query>      Search events');
  lines.push('  continuum context resume      Generate transfer context');
  lines.push('  continuum capsule export      Export portable capsule');
  lines.push('  continuum verify generate     Generate verification checks');
  lines.push('  continuum scan                Security scan before transfer');
  lines.push('');

  return lines.join('\n');
}

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Display a visual project overview dashboard')
    .option('--json', 'Output as JSON', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const snapshot = buildDashboard(opts.root, projectId);

      if (!snapshot) {
        console.error('\n✗ Could not build dashboard. Project may be missing.\n');
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      console.log(formatDashboard(snapshot));
    });
}
