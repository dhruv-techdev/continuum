import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import { initWorkspace, loadConfig, DEFAULT_ROOT } from '@dhruv-techdev/continuum-core';

function formatInitResult(result: ReturnType<typeof initWorkspace>): string {
  const lines: string[] = [];

  if (result.alreadyExists) {
    lines.push(`\nWorkspace already initialized at ${result.root}`);

    const { config, errors } = loadConfig(result.root);
    if (errors.length > 0) {
      lines.push('\n⚠ Configuration has issues:\n');
      for (const err of errors) {
        lines.push(`  ✗ ${err.field}: ${err.message}`);
      }
      lines.push('\n  Fix config.json or delete it and run "continuum init" again.\n');
    } else {
      lines.push(`  Config version: ${config!.version}`);
      lines.push(`  Local only:     ${config!.privacy.localOnly}`);
      lines.push(`  Hash algorithm:  ${config!.capture.hashAlgorithm}`);
      lines.push('\n  Use "continuum init --force" to reinitialize.\n');
    }
    return lines.join('\n');
  }

  if (result.errors.length > 0) {
    lines.push('\n✗ Workspace initialization failed:\n');
    for (const err of result.errors) {
      lines.push(`  ✗ ${err}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`\n✓ Workspace initialized at ${result.root}\n`);
  lines.push('  Created:');
  lines.push(`    config.json`);
  for (const dir of result.dirsCreated) {
    lines.push(`    ${dir}/`);
  }
  lines.push('\n  Next steps:');
  lines.push('    continuum doctor     Check environment');
  lines.push('    continuum capture    Start capturing a session (coming soon)');
  lines.push('');

  return lines.join('\n');
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize the Continuum workspace')
    .option('--root <path>', 'Workspace root directory', DEFAULT_ROOT)
    .option('--force', 'Reinitialize even if workspace exists', false)
    .action((opts) => {
      const root: string = opts.root;

      // If force, we blow past the alreadyExists check by removing config first
      if (opts.force) {
        const configPath = join(root, 'config.json');
        if (existsSync(configPath)) {
          unlinkSync(configPath);
        }
      }

      const result = initWorkspace(root);
      const output = formatInitResult(result);
      console.log(output);

      if (result.errors.length > 0) process.exit(1);
    });
}
