import { Command } from 'commander';
import { execSync } from 'child_process';
import { accessSync, mkdirSync, constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  VERSION,
  MIN_NODE_VERSION,
  isWorkspaceInitialized,
  loadConfig,
  DEFAULT_ROOT,
} from '@dhruv-techdev/continuum-core';
import type { CheckResult } from '@dhruv-techdev/continuum-core';

export function runChecks(): CheckResult[] {
  const checks: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  checks.push({
    name: 'Node.js',
    status: major >= MIN_NODE_VERSION ? 'pass' : 'fail',
    message:
      major >= MIN_NODE_VERSION
        ? `${nodeVersion} (>= ${MIN_NODE_VERSION}.0.0 required)`
        : `${nodeVersion} — Node.js >= ${MIN_NODE_VERSION}.0.0 is required`,
  });

  // 2. pnpm
  try {
    const pnpmVersion = execSync('pnpm --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    checks.push({ name: 'pnpm', status: 'pass', message: `v${pnpmVersion}` });
  } catch {
    checks.push({ name: 'pnpm', status: 'warn', message: 'not found (optional)' });
  }

  // 3. TypeScript
  try {
    const tsOutput = execSync('npx tsc --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    checks.push({ name: 'TypeScript', status: 'pass', message: tsOutput });
  } catch {
    checks.push({ name: 'TypeScript', status: 'fail', message: 'not found' });
  }

  // 4. Data directory
  const dataDir = join(homedir(), '.continuum');
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    checks.push({ name: 'Data directory', status: 'pass', message: `${dataDir} (writable)` });
  } catch {
    checks.push({ name: 'Data directory', status: 'fail', message: `${dataDir} (not writable)` });
  }

  // 5. Workspace initialized
  if (isWorkspaceInitialized(DEFAULT_ROOT)) {
    const { config, errors } = loadConfig(DEFAULT_ROOT);
    if (errors.length > 0) {
      checks.push({
        name: 'Workspace',
        status: 'warn',
        message: `Initialized but config has ${errors.length} issue(s). Run "continuum init --force".`,
      });
    } else {
      checks.push({
        name: 'Workspace',
        status: 'pass',
        message: `v${config!.version} — local-only: ${config!.privacy.localOnly}`,
      });
    }
  } else {
    checks.push({
      name: 'Workspace',
      status: 'warn',
      message: 'Not initialized. Run "continuum init".',
    });
  }

  return checks;
}

export function formatChecks(checks: CheckResult[]): string {
  const lines: string[] = [`\nContinuum v${VERSION} — Environment Check\n`];
  let hasFailure = false;

  for (const check of checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    lines.push(`  ${icon} ${check.name.padEnd(16)} ${check.message}`);
    if (check.status === 'fail') hasFailure = true;
  }

  lines.push('');
  lines.push(
    hasFailure ? 'Some checks failed. Please fix the issues above.\n' : 'All checks passed.\n',
  );

  return lines.join('\n');
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check environment and configuration')
    .action(() => {
      const checks = runChecks();
      const output = formatChecks(checks);
      console.log(output);

      const hasFailure = checks.some((c) => c.status === 'fail');
      if (hasFailure) process.exit(1);
    });
}
