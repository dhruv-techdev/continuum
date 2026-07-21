import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_ROOT,
  getState,
  setActiveSession,
  startSession,
  adapterRegistry,
  adapterNormalize,
  importTranscript,
  parseTranscript,
} from '@continuum/core';
import type { ImportWarning } from '@continuum/core';
import { openLedger } from '@continuum/core';

function requireActiveProject(root: string): string {
  const state = getState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error(
      '  Run "continuum project select <id>" or "continuum project create -t <title>" first.\n',
    );
    process.exit(1);
  }
  return state.activeProjectId;
}

function formatWarnings(warnings: ImportWarning[], verbose: boolean): string {
  if (warnings.length === 0) return '';

  const lines: string[] = ['\n  Warnings:\n'];
  const limit = verbose ? warnings.length : Math.min(warnings.length, 10);

  for (let i = 0; i < limit; i++) {
    const w = warnings[i];
    const idx = w.messageIndex !== undefined ? ` (message ${w.messageIndex})` : '';
    lines.push(`    ⚠ [${w.type}] ${w.field}${idx}: ${w.message}`);
  }

  if (!verbose && warnings.length > limit) {
    lines.push(`\n    ... and ${warnings.length - limit} more. Use --verbose to see all.`);
  }

  return lines.join('\n');
}

export function registerImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import an AI transcript into the active project')
    .option(
      '-a, --adapter <id>',
      'Force a specific adapter (claude, chatgpt, generic-json, generic-markdown)',
    )
    .option('-p, --provider <name>', 'AI provider name', 'import')
    .option('-m, --model <name>', 'Model identifier', 'unknown')
    .option('--verbose', 'Show all warnings', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((file: string, opts) => {
      if (!existsSync(file)) {
        console.error(`\n✗ File not found: ${file}\n`);
        process.exit(1);
      }

      const projectId = requireActiveProject(opts.root);
      const raw = readFileSync(file, 'utf-8');

      // Detect or use forced adapter
      let adapter = opts.adapter
        ? adapterRegistry.get(opts.adapter)
        : adapterRegistry.detect(raw, file);

      if (opts.adapter && !adapter) {
        console.error(
          `\n✗ Unknown adapter "${opts.adapter}". Available: ${adapterRegistry.list().join(', ')}\n`,
        );
        process.exit(1);
      }

      // Use adapter-aware pipeline if a provider-specific adapter was detected
      if (adapter && adapter.id !== 'generic-json' && adapter.id !== 'generic-markdown') {
        const parseResult = adapter.parse(raw);

        if (parseResult.messages.length === 0) {
          console.error('\n✗ No messages found in transcript.\n');
          if (parseResult.warnings.length > 0) {
            console.error(formatWarnings(parseResult.warnings, opts.verbose));
          }
          process.exit(1);
        }

        // Create session
        const sessionResult = startSession(opts.root, {
          projectId,
          provider: parseResult.detectedProvider ?? opts.provider,
          model: opts.model,
        });

        if (sessionResult.error) {
          console.error(`\n✗ ${sessionResult.error}\n`);
          process.exit(1);
        }

        const session = sessionResult.data!;
        setActiveSession(opts.root, session.id);

        // Normalize with adapter-aware normalizer
        const normalized = adapterNormalize({
          parseResult,
          projectId,
          sessionId: session.id,
          source: `import:${adapter.id}:${file}`,
        });

        // Write to ledger
        if (normalized.events.length > 0) {
          const ledger = openLedger(opts.root, projectId, session.id);
          const batchResult = ledger.appendBatch(normalized.events);

          // Update session event count
          const sessPath = join(
            opts.root,
            'projects',
            projectId,
            'sessions',
            session.id,
            'session.json',
          );
          if (existsSync(sessPath)) {
            const sessData = JSON.parse(readFileSync(sessPath, 'utf-8'));
            sessData.eventCount = (sessData.eventCount ?? 0) + batchResult.appended;
            writeFileSync(sessPath, JSON.stringify(sessData, null, 2) + '\n', 'utf-8');
          }
        }

        console.log('\n✓ Transcript imported\n');
        console.log(`  File:         ${file}`);
        console.log(`  Adapter:      ${adapter.name} (${adapter.id})`);
        console.log(`  Provider:     ${parseResult.detectedProvider ?? opts.provider}`);
        console.log(`  Session:      ${session.id}`);
        console.log(`  Messages:     ${normalized.stats.messagesCreated}`);
        console.log(`  Tool calls:   ${normalized.stats.toolCallsCreated}`);
        console.log(`  Tool results: ${normalized.stats.toolResultsCreated}`);
        console.log(`  Skipped:      ${normalized.stats.skipped}`);
        console.log(`  Warnings:     ${normalized.warnings.length}`);

        if (normalized.warnings.length > 0) {
          console.log(formatWarnings(normalized.warnings, opts.verbose));
        }

        console.log('');
        return;
      }

      // Fall back to the original generic import pipeline (US-005)
      const parseResult = parseTranscript(file);

      if (parseResult.messages.length === 0) {
        console.error('\n✗ No messages found in transcript.\n');
        if (parseResult.warnings.length > 0) {
          console.error(formatWarnings(parseResult.warnings, opts.verbose));
        }
        process.exit(1);
      }

      const sessionResult = startSession(opts.root, {
        projectId,
        provider: parseResult.detectedProvider ?? opts.provider,
        model: opts.model,
      });

      if (sessionResult.error) {
        console.error(`\n✗ ${sessionResult.error}\n`);
        process.exit(1);
      }

      const session = sessionResult.data!;
      setActiveSession(opts.root, session.id);

      const source = `import:${file}`;
      const result = importTranscript(opts.root, projectId, session.id, parseResult, source);

      console.log('\n✓ Transcript imported\n');
      console.log(`  File:      ${file}`);
      console.log(`  Format:    ${parseResult.format}`);
      if (parseResult.detectedProvider) {
        console.log(`  Provider:  ${parseResult.detectedProvider} (detected)`);
      }
      console.log(`  Session:   ${session.id}`);
      console.log(`  Events:    ${result.stats.eventsCreated} created`);
      if (result.stats.skipped > 0) {
        console.log(`  Skipped:   ${result.stats.skipped}`);
      }
      console.log(`  Warnings:  ${result.stats.warningCount}`);

      if (result.warnings.length > 0) {
        console.log(formatWarnings(result.warnings, opts.verbose));
      }

      console.log('');
    });

  // ── adapters subcommand ─────────────────────────────────

  program
    .command('adapters')
    .description('List available import adapters')
    .action(() => {
      console.log('\n  Available Adapters:\n');

      for (const id of adapterRegistry.list()) {
        const adapter = adapterRegistry.get(id)!;
        console.log(`  ${adapter.id.padEnd(20)} ${adapter.name}`);
        console.log(`    Provider: ${adapter.provider}`);
        console.log(`    Extensions: ${adapter.extensions.join(', ')}`);
        console.log('');
      }

      console.log('  Usage: continuum import <file> --adapter claude\n');
    });
}
