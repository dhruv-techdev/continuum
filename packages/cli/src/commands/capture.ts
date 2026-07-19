import { Command } from 'commander';
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
  generateCallId,
  openLedger,
} from '@continuum/core';
import type { CaptureResult } from '@continuum/core';

// ─── Context resolution (ST2) ───────────────────────────────

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
        payload: { role, content: opts.content },
      });

      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);
      console.log(formatResult(result, false));
    });

  // ── capture tool-call (ST1 + ST3) ───────────────────────

  capture
    .command('tool-call')
    .description('Capture a tool call event')
    .requiredOption('-n, --name <toolName>', 'Tool name')
    .option('-i, --input <json>', 'Tool input as JSON', '{}')
    .option('--call-id <id>', 'Correlation ID (auto-generated if omitted)')
    .option('--source <name>', 'Event source', 'cli')
    .option('--project <id>', 'Project ID')
    .option('--session <id>', 'Session ID')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      let input: Record<string, unknown>;
      try {
        input = JSON.parse(opts.input);
      } catch {
        console.error('\n✗ --input must be valid JSON.\n');
        process.exit(1);
      }

      const callId = opts.callId ?? generateCallId();

      const result = quickCapture({
        workspaceRoot: opts.root,
        projectId,
        sessionId,
        type: EventTypes.TOOL_CALL,
        source: opts.source,
        payload: { toolName: opts.name, input, callId },
      });

      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);

      if (result.appended > 0) {
        console.log(`\n✓ Tool call captured (callId: ${callId})\n`);
        console.log(`  Tool:    ${opts.name}`);
        console.log(`  Call ID: ${callId}`);
        console.log(`\n  Use this callId with "capture tool-result --call-id ${callId}" to record the result.\n`);
      } else {
        console.log(formatResult(result, false));
      }
    });

  // ── capture tool-result (ST1 + ST3) ─────────────────────

  capture
    .command('tool-result')
    .description('Capture a tool result event')
    .requiredOption('-n, --name <toolName>', 'Tool name')
    .requiredOption('-o, --output <text>', 'Tool output')
    .option('--call-id <id>', 'Correlation ID linking to the tool call')
    .option('--is-error', 'Mark this result as an error', false)
    .option('--source <name>', 'Event source', 'cli')
    .option('--project <id>', 'Project ID')
    .option('--session <id>', 'Session ID')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const { projectId, sessionId } = resolveContext(opts.root, opts);

      const payload: Record<string, unknown> = {
        toolName: opts.name,
        output: opts.output,
      };

      if (opts.callId) payload.callId = opts.callId;
      if (opts.isError) payload.isError = true;

      const result = quickCapture({
        workspaceRoot: opts.root,
        projectId,
        sessionId,
        type: EventTypes.TOOL_RESULT,
        source: opts.source,
        payload,
      });

      updateSessionAfterCapture(opts.root, projectId, sessionId, result.appended);

      if (result.appended > 0) {
        const link = opts.callId ? ` (linked to callId: ${opts.callId})` : ' (no callId — unlinked)';
        console.log(`\n✓ Tool result captured${link}\n`);
        console.log(`  Tool:     ${opts.name}`);
        console.log(`  Error:    ${opts.isError}`);
        if (opts.callId) console.log(`  Call ID:  ${opts.callId}`);
        console.log('');
      } else {
        console.log(formatResult(result, false));
      }
    });

  // ── capture command (ST2) ───────────────────────────────

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
      let commandEventId: string | null = null;

      // Get the event ID of the command we just captured for correlation (ST3)
      if (cmdResult.appended > 0) {
        const ledger = openLedger(opts.root, projectId, sessionId);
        const lastEvent = ledger.getEvent(
          ledger.readAll().events[ledger.readAll().events.length - 1]?.id ?? '',
        );
        commandEventId = lastEvent?.id ?? null;
      }

      // If output was provided, capture a correlated command_output event (ST3)
      if (cmdResult.appended > 0 && commandEventId && (opts.stdout || opts.stderr || opts.exitCode !== undefined)) {
        const outputResult = quickCapture({
          workspaceRoot: opts.root,
          projectId,
          sessionId,
          type: EventTypes.COMMAND_OUTPUT,
          source: opts.source,
          payload: {
            commandEventId,
            ...(opts.stdout ? { stdout: opts.stdout } : {}),
            ...(opts.stderr ? { stderr: opts.stderr } : {}),
            ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
          },
        });
        totalAppended += outputResult.appended;
      }

      updateSessionAfterCapture(opts.root, projectId, sessionId, totalAppended);

      if (totalAppended > 0) {
        const hasOutput = opts.stdout || opts.stderr || opts.exitCode !== undefined;
        console.log(`\n✓ Captured ${totalAppended} event(s) (command${hasOutput ? ' + output' : ''})\n`);
        console.log(`  Command:  ${opts.cmd}`);
        if (commandEventId) console.log(`  Event ID: ${commandEventId}`);
        if (opts.exitCode !== undefined) console.log(`  Exit:     ${opts.exitCode}`);
        if (hasOutput && commandEventId) {
          console.log(`\n  Output linked via commandEventId: ${commandEventId}`);
        }
        console.log('');
      } else {
        console.log(formatResult(cmdResult, false));
      }
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
