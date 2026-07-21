import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  setActiveSession,
  startSession,
  closeSession,
  listSessions,
  getProject,
  SessionStatuses,
} from '@dhruv-techdev/continuum-core';

function requireActiveProject(root: string): { projectId: string } {
  const state = getState(root);

  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error(
      '  Run "continuum project select <id>" or "continuum project create -t <title>" first.\n',
    );
    process.exit(1);
  }

  const project = getProject(root, state.activeProjectId);
  if (!project) {
    console.error(`\n✗ Active project "${state.activeProjectId}" not found on disk.`);
    console.error('  Run "continuum project list" and select a valid project.\n');
    process.exit(1);
  }

  return { projectId: state.activeProjectId };
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Manage sessions within the active project');

  // ── start ───────────────────────────────────────────────────

  session
    .command('start')
    .description('Start a new capture session')
    .option('-p, --provider <name>', 'AI provider name', 'unknown')
    .option('-m, --model <name>', 'Model identifier', 'unknown')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const { projectId } = requireActiveProject(opts.root);

      const result = startSession(opts.root, {
        projectId,
        provider: opts.provider,
        model: opts.model,
      });

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      const s = result.data!;
      setActiveSession(opts.root, s.id);

      console.log('\n✓ Session started\n');
      console.log(`  ID:       ${s.id}`);
      console.log(`  Project:  ${s.projectId}`);
      console.log(`  Provider: ${s.provider}`);
      console.log(`  Model:    ${s.model}`);
      console.log(`  Status:   active\n`);
    });

  // ── list ────────────────────────────────────────────────────

  session
    .command('list')
    .description('List sessions in the active project')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const { projectId } = requireActiveProject(opts.root);
      const sessions = listSessions(opts.root, projectId);
      const state = getState(opts.root);

      if (sessions.length === 0) {
        console.log('\n  No sessions yet. Run "continuum session start" to begin capturing.\n');
        return;
      }

      console.log(`\n  Sessions (${sessions.length}):\n`);

      for (const s of sessions) {
        const isActive = s.id === state.activeSessionId ? ' ← active' : '';
        const statusIcon = s.status === SessionStatuses.ACTIVE ? '●' : '○';
        console.log(`  ${statusIcon} ${s.id}${isActive}`);
        console.log(`    Provider: ${s.provider} / ${s.model}`);
        console.log(`    Started:  ${s.startedAt}`);
        if (s.closedAt) {
          console.log(`    Closed:   ${s.closedAt}`);
        }
        console.log(`    Events:   ${s.eventCount}`);
        console.log('');
      }
    });

  // ── close ───────────────────────────────────────────────────

  session
    .command('close [sessionId]')
    .description('Close a session (defaults to active session)')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((sessionId: string | undefined, opts) => {
      const { projectId } = requireActiveProject(opts.root);
      const state = getState(opts.root);

      const targetId = sessionId ?? state.activeSessionId;

      if (!targetId) {
        console.error('\n✗ No session specified and no active session.');
        console.error('  Run "continuum session list" to see available sessions.\n');
        process.exit(1);
      }

      const result = closeSession(opts.root, projectId, targetId);

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      // Clear active session if we just closed it
      if (state.activeSessionId === targetId) {
        setActiveSession(opts.root, null);
      }

      const s = result.data!;
      console.log('\n✓ Session closed\n');
      console.log(`  ID:      ${s.id}`);
      console.log(`  Closed:  ${s.closedAt}`);
      console.log(`  Events:  ${s.eventCount}\n`);
    });
}
