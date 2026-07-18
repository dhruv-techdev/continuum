import { Command } from 'commander';
import { existsSync } from 'fs';
import {
  DEFAULT_ROOT,
  getState,
  setActiveSession,
  startSession,
  parseTranscript,
  importTranscript,
} from '@continuum/core';
import type { ImportWarning } from '@continuum/core';

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
    .option('-p, --provider <name>', 'AI provider name', 'import')
    .option('-m, --model <name>', 'Model identifier', 'unknown')
    .option('--verbose', 'Show all warnings', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((file: string, opts) => {
      // Validate file exists
      if (!existsSync(file)) {
        console.error(`\n✗ File not found: ${file}\n`);
        process.exit(1);
      }

      const projectId = requireActiveProject(opts.root);

      // Parse the transcript
      const parseResult = parseTranscript(file);

      if (parseResult.messages.length === 0) {
        console.error('\n✗ No messages found in transcript.\n');
        if (parseResult.warnings.length > 0) {
          console.error(formatWarnings(parseResult.warnings, opts.verbose));
        }
        process.exit(1);
      }

      // Create a session for this import
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

      // Import into the session
      const source = `import:${file}`;
      const result = importTranscript(opts.root, projectId, session.id, parseResult, source);

      // Output
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
}
