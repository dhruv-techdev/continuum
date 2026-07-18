import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import {
  DEFAULT_ROOT,
  getState,
  setActiveSession,
  getProject,
  getSession,
  startSession,
  EventTypes,
  MessageRoles,
  quickCapture,
  ingestFromFile,
  ingestRawEvents,
  updateSessionAfterCapture,
} from '@continuum/core';
import type { CaptureResult, EventType } from '@continuum/core';

// ─── ST2: Require active project + session ──────────────────

function resolveContext(root: string, opts: { project?: string; session?: string }) {
  const ws = getState(root);

  const projectId = opts.project ?? ws.activeProjectId;
  if (!projectId) {
    console.error('\n✗ No active project.');
    console.error('  Run "continuum project select <id>" or pass --project.\n');
    process.exit(1);
  }

  const project = getProject(root, projectId);
  if (!project) {
    console.error(`\n✗ Project "${projectId}" not found.\n`);
    process.exit(1);
  }

  let sessionId = opts.session ?? ws.activeSessionId;

  // Auto-start a session if none is active
  if (!sessionId) {
    const result = startSession(root, { projectId, provider: 'cli', model: 'manual' });
    if (result.error) {
      console.error(`\n✗ ${result.error}\n`);
      process.exit(1);
    }
    sessionId = result.data!.id;
    setActiveSession(root, sessionId);
    console.log(`  Auto-started session: ${sessionId}`);
  } else {
    const session = getSession(root, projectId, sessionId);
    if (!session) {
      console.error(`\n✗ Session "${sessionId}" not found in project "${projectId}".\n`);
      process.exit(1);
    }
    if (session.status === 'closed') {
      console.error(`\n✗ Session "${sessionId}" is closed. Start a new one with "continuum session start".\n`);
      process.exit(1);
    }
  }

  return { projectId, sessionId };
}

// ─── ST3: Format capture result ─────────────────────────────

function formatResult(result: CaptureResult, verbose: boolean): string {
  const lines: string[] = [];

  if (result.appended > 0) {
    lines.push(`\n✓ Captured ${result.appended} event(s)\n`);
  } else if (result.errors.length === 0 && result.duplicatesSkipped > 0) {
    lines.push(`\n⚠ No new events (${result.duplicatesSkipped} duplicate(s) skipped)\n`);
  } else {
    lines.push('\n✗ No events captured\n');
  }

  lines.push(`  Processed:  ${result.totalProcessed}`);
  lines.push(`  Appended:   ${result.appended}`);

  if (result.duplicatesSkipped > 0) {
    lines.push(`  Duplicates: ${result.duplicatesSkipped} (skipped)`);
  }
  if (result.validationErrors > 0) {
    lines.push(`  Invalid:    ${result.validationErrors}`);
  }
  if (result.parseErrors > 0) {
    lines.push(`  Parse errs: ${result.parseErrors}`);
  }

  if (result.errors.length > 0) {
    lines.push('');
    const limit = verbose ? result.errors.length : Math.min(result.errors.length, 10);
    for (let i = 0; i < limit; i++) {
      const e = result.errors[i];
      const loc = e.line ? `L${e.line}` : e.eventId ? e.eventId.slice(0, 20) : '—';
      lines.push(`  ✗ [${loc}] ${e.message}`);
    }
    if (!verbose && result.errors.length > limit) {
      lines.push(`\n  ... and ${result.errors.length - limit} more. Use --verbose.`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Register ───────────────────────────────────────────────

export function registerCaptureCommand(program: Command): void {
  const capture = program
    .command('capture')
    .description('Capture events into the active session');

  // ── capture message ─────────────────────────────────────

  capture
    .command('message')
    .description('Capture a single message event')
    .requiredOption('-r, --role <role>', 'Message role (user, assistant, system)')
    .requiredOption('-c, --content <text>', 'Message content')
    .option('--source <name>', 'Event source', 'cli')
    .option('--project <id>', 'Project ID (default: active)')
    .option('--session <id>', 'Session ID (default: active)')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      const role = opts.role.toLowerCase();
      if (!['user', 'assistant', 'system'].includes(role)) {
        console.error(`\n✗ Invalid role "${opts.role}". Must be user, assistant, or system.\n`);
        process.exit(1);
      }

      const result = quickCapture({
        workspaceRoot: opts.root,
        projectId,
        sessionId,
        type: EventTypes.MESSAGE,
        source: opts.source,
        payload: { role: role as 'user' | 'assistant' | 'system', content: opts.content },
      });

      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);
      console.log(formatResult(result, false));
    });

  // ── capture command ─────────────────────────────────────

  capture
    .command('command')
    .description('Capture a shell command event')
    .requiredOption('-c, --cmd <command>', 'The command that was run')
    .option('--cwd <path>', 'Working directory')
    .option('--stdout <text>', 'Command stdout')
    .option('--stderr <text>', 'Command stderr')
    .option('--exit-code <code>', 'Exit code', parseInt)
    .option('--source <name>', 'Event source', 'cli')
    .option('--project <id>', 'Project ID')
    .option('--session <id>', 'Session ID')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      // Capture the command event
      const cmdResult = quickCapture({
        workspaceRoot: opts.root,
        projectId,
        sessionId,
        type: EventTypes.COMMAND,
        source: opts.source,
        payload: {
          command: opts.cmd,
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
        },
      });

      let totalAppended = cmdResult.appended;

      // If output was provided, capture a command_output event too
      if (cmdResult.appended > 0 && (opts.stdout || opts.stderr || opts.exitCode !== undefined)) {
        const outputResult = quickCapture({
          workspaceRoot: opts.root,
          projectId,
          sessionId,
          type: EventTypes.COMMAND_OUTPUT,
          source: opts.source,
          payload: {
            commandEventId: 'previous',
            ...(opts.stdout ? { stdout: opts.stdout } : {}),
            ...(opts.stderr ? { stderr: opts.stderr } : {}),
            ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
          },
        });
        totalAppended += outputResult.appended;
      }

      updateSessionAfterCapture(opts.root, projectId, sessionId, totalAppended);

      const display: CaptureResult = {
        ...cmdResult,
        appended: totalAppended,
        totalProcessed: opts.stdout || opts.stderr || opts.exitCode !== undefined ? 2 : 1,
      };
      console.log(formatResult(display, false));
    });

  // ── capture note ────────────────────────────────────────

  capture
    .command('note <text>')
    .description('Capture a quick note as a user message')
    .option('--source <name>', 'Event source', 'cli')
    .option('--project <id>', 'Project ID')
    .option('--session <id>', 'Session ID')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((text: string, opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      const result = quickCapture({
        workspaceRoot: opts.root,
        projectId,
        sessionId,
        type: EventTypes.MESSAGE,
        source: opts.source,
        payload: { role: MessageRoles.USER, content: text },
      });

      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);
      console.log(formatResult(result, false));
    });

  // ── capture file (ST1) ──────────────────────────────────

  capture
    .command('file <path>')
    .description('Ingest pre-formed events from a JSONL or JSON file')
    .option('--verbose', 'Show all errors', false)
    .option('--project <id>', 'Project ID')
    .option('--session <id>', 'Session ID')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((filePath: string, opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      const result = ingestFromFile(opts.root, projectId, sessionId, filePath);
      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);
      console.log(formatResult(result, opts.verbose));

      if (result.appended === 0 && result.errors.length > 0) process.exit(1);
    });

  // ── capture stdin (ST1) ─────────────────────────────────

  capture
    .command('stdin')
    .description('Ingest pre-formed events from standard input (JSONL)')
    .option('--verbose', 'Show all errors', false)
    .option('--project <id>', 'Project ID')
    .option('--session <id>', 'Session ID')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action(async (opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      const chunks: Buffer[] = [];
      const stdin = process.stdin;
      stdin.resume();

      for await (const chunk of stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString('utf-8');

      if (raw.trim().length === 0) {
        console.log('\n⚠ No input received from stdin.\n');
        return;
      }

      const result = ingestRawEvents(opts.root, projectId, sessionId, raw);
      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);
      console.log(formatResult(result, opts.verbose));

      if (result.appended === 0 && result.errors.length > 0) process.exit(1);
    });
}
