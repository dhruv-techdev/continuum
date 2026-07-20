import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  openDB,
  closeDB,
  recoverWorkspace,
  countAllEvents,
  getEventById,
  getEventsByIds,
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

function ensureSynced(root: string, projectId: string): void {
  const db = openDB(root);
  if (countAllEvents(db, projectId) === 0) {
    recoverWorkspace(db, root);
  }
}

export function registerEventCommand(program: Command): void {
  const event = program.command('event').description('Retrieve events by ID');

  // ── event show <id> ─────────────────────────────────────

  event
    .command('show <eventId>')
    .description('Show full details of a single event by its ID')
    .option('--json', 'Output raw JSON', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((eventId: string, opts) => {
      const projectId = requireActiveProject(opts.root);
      ensureSynced(opts.root, projectId);

      const db = openDB(opts.root);
      const entry = getEventById(db, eventId);
      closeDB(opts.root);

      if (!entry) {
        console.error(`\n✗ Event "${eventId}" not found.`);
        console.error('  Make sure the event exists and "continuum db sync" has been run.\n');
        process.exit(1);
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              id: entry.id,
              projectId: entry.projectId,
              sessionId: entry.sessionId,
              type: entry.type,
              sequence: entry.sequence,
              timestamp: entry.timestamp,
              source: entry.source,
              hash: entry.hash,
              schemaVersion: entry.schemaVersion,
              payload: entry.payload,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`\n─── Event: ${entry.id}\n`);
      console.log(`  Type:        ${entry.type}`);
      console.log(`  Sequence:    ${entry.sequence}`);
      console.log(`  Timestamp:   ${entry.timestamp}`);
      console.log(`  Session:     ${entry.sessionId}`);
      console.log(`  Project:     ${entry.projectId}`);
      console.log(`  Source:      ${entry.source}`);
      console.log(`  Hash:        ${entry.hash}`);
      console.log(`  Schema:      ${entry.schemaVersion}`);
      console.log(`\n  Payload:`);
      console.log(indent(JSON.stringify(entry.payload, null, 2), 4));
      console.log('');
    });

  // ── event batch <id...> ─────────────────────────────────

  event
    .command('batch')
    .description('Retrieve multiple events by their IDs')
    .argument('<ids...>', 'One or more event IDs')
    .option('--json', 'Output raw JSON array', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((ids: string[], opts) => {
      const projectId = requireActiveProject(opts.root);
      ensureSynced(opts.root, projectId);

      const db = openDB(opts.root);
      const entries = getEventsByIds(db, ids);
      closeDB(opts.root);

      if (opts.json) {
        const events = entries.map((e) => ({
          id: e.id,
          projectId: e.projectId,
          sessionId: e.sessionId,
          type: e.type,
          sequence: e.sequence,
          timestamp: e.timestamp,
          source: e.source,
          hash: e.hash,
          schemaVersion: e.schemaVersion,
          payload: e.payload,
        }));
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log('\n  No matching events found.\n');
        return;
      }

      const missing = ids.filter((id) => !entries.some((e) => e.id === id));

      console.log(`\n─── Retrieved ${entries.length}/${ids.length} event(s)\n`);

      for (const entry of entries) {
        const ts = entry.timestamp.slice(0, 19).replace('T', ' ');
        console.log(`  ${entry.id}`);
        console.log(`    Type: ${entry.type}  Seq: ${entry.sequence}  Time: ${ts}`);
        console.log(`    ${entry.preview}`);
        console.log('');
      }

      if (missing.length > 0) {
        console.log(`  ⚠ Not found: ${missing.join(', ')}\n`);
      }
    });
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}
