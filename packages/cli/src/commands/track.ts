import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  createDecision, listDecisions, getDecision, rejectDecision, supersedeDecision,
  DecisionStatuses,
  createTask, listTasks, updateTaskStatus, getTask,
  TaskStatuses, VALID_TASK_STATUSES,
  recordAttempt, listAttempts, getFailedAttempts, getAttempt,
  AttemptOutcomes,
} from '@continuum/core';
import type { TaskStatus, AttemptOutcome } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

export function registerTrackCommand(program: Command): void {
  const track = program.command('track').description('Track decisions, tasks, and attempts');

  // ═══════════════ DECISIONS (ST1) ═══════════════════════

  const dec = track.command('decision').description('Track decisions');

  dec.command('add')
    .description('Record a new decision')
    .requiredOption('-c, --choice <text>', 'What was decided')
    .option('-r, --rationale <text>', 'Why this was chosen')
    .option('-a, --alternatives <items>', 'Comma-separated alternatives considered')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const pid = requireProject(opts.root);
      const d = createDecision(opts.root, {
        projectId: pid,
        choice: opts.choice,
        rationale: opts.rationale,
        alternatives: opts.alternatives ? opts.alternatives.split(',').map((s: string) => s.trim()) : [],
      });
      console.log(`\n✓ Decision recorded\n`);
      console.log(`  ID:          ${d.id}`);
      console.log(`  Choice:      ${d.choice}`);
      if (d.rationale) console.log(`  Rationale:   ${d.rationale}`);
      if (d.alternatives.length) console.log(`  Alternatives: ${d.alternatives.join(', ')}`);
      console.log(`  Status:      ${d.status}\n`);
    });

  dec.command('list')
    .description('List decisions')
    .option('--all', 'Include rejected/superseded', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const pid = requireProject(opts.root);
      const decs = listDecisions(opts.root, pid, opts.all);
      if (decs.length === 0) { console.log('\n  No decisions recorded.\n'); return; }
      console.log(`\n  Decisions (${decs.length}):\n`);
      for (const d of decs) {
        const icon = d.status === 'active' ? '●' : d.status === 'rejected' ? '✗' : '○';
        console.log(`  ${icon} ${d.id}  ${d.choice}`);
        if (d.rationale) console.log(`    Rationale: ${d.rationale}`);
        if (d.alternatives.length) console.log(`    Alternatives: ${d.alternatives.join(', ')}`);
        if (d.rejectionReason) console.log(`    Rejected: ${d.rejectionReason}`);
        if (d.supersededBy) console.log(`    Superseded by: ${d.supersededBy}`);
        console.log(`    Status: ${d.status}  Created: ${d.createdAt.slice(0, 19)}`);
        console.log('');
      }
    });

  dec.command('reject <decisionId>')
    .description('Reject a decision')
    .requiredOption('-r, --reason <text>', 'Why it was rejected')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((id: string, opts) => {
      const pid = requireProject(opts.root);
      const d = rejectDecision(opts.root, pid, id, opts.reason);
      if (!d) { console.error(`\n✗ Decision "${id}" not found.\n`); process.exit(1); }
      console.log(`\n✓ Decision rejected: ${d.choice}\n  Reason: ${opts.reason}\n`);
    });

  dec.command('supersede <oldDecisionId>')
    .description('Replace a decision with a new one')
    .requiredOption('-c, --choice <text>', 'New decision')
    .option('-r, --rationale <text>', 'Why the change')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((oldId: string, opts) => {
      const pid = requireProject(opts.root);
      const result = supersedeDecision(opts.root, pid, oldId, { projectId: pid, choice: opts.choice, rationale: opts.rationale });
      if (!result) { console.error(`\n✗ Decision "${oldId}" not found.\n`); process.exit(1); }
      console.log(`\n✓ Decision superseded\n`);
      console.log(`  Old: ${result.old.choice} → ${result.old.status}`);
      console.log(`  New: ${result.new.choice} (${result.new.id})\n`);
    });

  // ═══════════════ TASKS (ST2) ═══════════════════════════

  const tsk = track.command('task').description('Track tasks');

  tsk.command('add')
    .description('Create a new task')
    .requiredOption('-d, --description <text>', 'Task description')
    .option('--deps <ids>', 'Comma-separated dependency task IDs')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const pid = requireProject(opts.root);
      const t = createTask(opts.root, {
        projectId: pid,
        description: opts.description,
        dependencies: opts.deps ? opts.deps.split(',').map((s: string) => s.trim()) : [],
      });
      console.log(`\n✓ Task created\n`);
      console.log(`  ID:     ${t.id}`);
      console.log(`  Desc:   ${t.description}`);
      console.log(`  Status: ${t.status}\n`);
    });

  tsk.command('list')
    .description('List tasks')
    .option('-s, --status <status>', 'Filter by status')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const pid = requireProject(opts.root);
      if (opts.status && !VALID_TASK_STATUSES.includes(opts.status)) {
        console.error(`\n✗ Invalid status. Valid: ${VALID_TASK_STATUSES.join(', ')}\n`);
        process.exit(1);
      }
      const tasks = listTasks(opts.root, pid, opts.status as TaskStatus | undefined);
      if (tasks.length === 0) { console.log('\n  No tasks found.\n'); return; }

      const icons: Record<string, string> = { pending: '○', active: '◐', completed: '●', blocked: '✗' };
      console.log(`\n  Tasks (${tasks.length}):\n`);
      for (const t of tasks) {
        console.log(`  ${icons[t.status] ?? '?'} ${t.id}  [${t.status}]`);
        console.log(`    ${t.description}`);
        if (t.dependencies.length) console.log(`    Deps: ${t.dependencies.join(', ')}`);
        if (t.blockedReason) console.log(`    Blocked: ${t.blockedReason}`);
        if (t.completionNote) console.log(`    Note: ${t.completionNote}`);
        console.log('');
      }
    });

  tsk.command('update <taskId>')
    .description('Update task status')
    .requiredOption('-s, --status <status>', 'New status (pending, active, completed, blocked)')
    .option('-n, --note <text>', 'Status note')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((taskId: string, opts) => {
      const pid = requireProject(opts.root);
      if (!VALID_TASK_STATUSES.includes(opts.status)) {
        console.error(`\n✗ Invalid status. Valid: ${VALID_TASK_STATUSES.join(', ')}\n`);
        process.exit(1);
      }
      const t = updateTaskStatus(opts.root, pid, taskId, opts.status as TaskStatus, opts.note);
      if (!t) { console.error(`\n✗ Task "${taskId}" not found.\n`); process.exit(1); }
      console.log(`\n✓ Task updated: ${t.description}\n  Status: ${t.status}\n`);
    });

  // ═══════════════ ATTEMPTS (ST3) ════════════════════════

  const att = track.command('attempt').description('Track attempts');

  att.command('add')
    .description('Record an attempt')
    .requiredOption('-a, --approach <text>', 'What was tried')
    .requiredOption('-o, --outcome <outcome>', 'Outcome: success, failure, partial, abandoned')
    .option('-f, --failure-reason <text>', 'Why it failed')
    .option('--observations <text>', 'What was learned')
    .option('--related <id>', 'Related task or decision ID')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const pid = requireProject(opts.root);
      const validOutcomes = Object.values(AttemptOutcomes);
      if (!validOutcomes.includes(opts.outcome)) {
        console.error(`\n✗ Invalid outcome. Valid: ${validOutcomes.join(', ')}\n`);
        process.exit(1);
      }
      const a = recordAttempt(opts.root, {
        projectId: pid,
        approach: opts.approach,
        outcome: opts.outcome as AttemptOutcome,
        failureReason: opts.failureReason,
        observations: opts.observations,
        relatedId: opts.related,
      });
      console.log(`\n✓ Attempt recorded\n`);
      console.log(`  ID:       ${a.id}`);
      console.log(`  Approach: ${a.approach}`);
      console.log(`  Outcome:  ${a.outcome}`);
      if (a.failureReason) console.log(`  Reason:   ${a.failureReason}`);
      if (a.observations) console.log(`  Learned:  ${a.observations}`);
      console.log('');
    });

  att.command('list')
    .description('List attempts')
    .option('--failures', 'Show only failures and abandoned', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const pid = requireProject(opts.root);
      const attempts = opts.failures
        ? getFailedAttempts(opts.root, pid)
        : listAttempts(opts.root, pid);
      if (attempts.length === 0) { console.log('\n  No attempts recorded.\n'); return; }

      const icons: Record<string, string> = { success: '✓', failure: '✗', partial: '◐', abandoned: '○' };
      console.log(`\n  Attempts (${attempts.length}):\n`);
      for (const a of attempts) {
        console.log(`  ${icons[a.outcome] ?? '?'} ${a.id}  [${a.outcome}]`);
        console.log(`    Approach: ${a.approach}`);
        if (a.failureReason) console.log(`    Reason:   ${a.failureReason}`);
        if (a.observations) console.log(`    Learned:  ${a.observations}`);
        if (a.relatedId) console.log(`    Related:  ${a.relatedId}`);
        console.log('');
      }
    });
}
