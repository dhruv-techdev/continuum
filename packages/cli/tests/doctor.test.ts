import { describe, it, expect } from 'vitest';
import { runChecks, formatChecks } from '../src/commands/doctor';

describe('doctor — runChecks()', () => {
  it('should return an array of check results', () => {
    const results = runChecks();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(4);
  });

  it('should pass the Node.js check on a supported runtime', () => {
    const results = runChecks();
    const nodeCheck = results.find((r) => r.name === 'Node.js');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe('pass');
  });

  it('should verify the data directory is writable', () => {
    const results = runChecks();
    const dirCheck = results.find((r) => r.name === 'Data directory');
    expect(dirCheck).toBeDefined();
    expect(dirCheck!.status).toBe('pass');
    expect(dirCheck!.message).toContain('.continuum');
  });
});

describe('doctor — formatChecks()', () => {
  it('should show "All checks passed" when everything passes', () => {
    const checks = [
      { name: 'Node.js', status: 'pass' as const, message: 'v20.0.0' },
      { name: 'pnpm', status: 'pass' as const, message: 'v9.0.0' },
    ];
    const output = formatChecks(checks);
    expect(output).toContain('All checks passed');
    expect(output).toContain('✓');
  });

  it('should show failure message when a check fails', () => {
    const checks = [
      { name: 'Node.js', status: 'fail' as const, message: 'v14.0.0' },
    ];
    const output = formatChecks(checks);
    expect(output).toContain('Some checks failed');
    expect(output).toContain('✗');
  });

  it('should show warning icon for warn status', () => {
    const checks = [
      { name: 'pnpm', status: 'warn' as const, message: 'not found' },
    ];
    const output = formatChecks(checks);
    expect(output).toContain('⚠');
    expect(output).not.toContain('Some checks failed');
  });
});
