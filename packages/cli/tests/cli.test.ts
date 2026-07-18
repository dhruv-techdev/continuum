import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

describe('continuum CLI', () => {
  it('should print help with --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('Continuum');
    expect(output).toContain('Verifiable state transfer');
    expect(output).toContain('doctor');
  });

  it('should print version with --version', () => {
    const output = execSync(`${CLI} --version`, { encoding: 'utf-8' });
    expect(output.trim()).toBe('0.1.0');
  });

  it('should print version with -v', () => {
    const output = execSync(`${CLI} -v`, { encoding: 'utf-8' });
    expect(output.trim()).toBe('0.1.0');
  });

  it('should run doctor without errors', () => {
    const output = execSync(`${CLI} doctor`, { encoding: 'utf-8' });
    expect(output).toContain('Environment Check');
    expect(output).toContain('Node.js');
    expect(output).toContain('Data directory');
  });
});
