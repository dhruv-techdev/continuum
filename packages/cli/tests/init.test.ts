import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolve } from 'path';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

describe('continuum init', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'continuum-cli-test-'));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('should initialize a workspace with --root', () => {
    const output = execSync(`${CLI} init --root ${testRoot}`, { encoding: 'utf-8' });
    expect(output).toContain('Workspace initialized');
    expect(existsSync(join(testRoot, 'config.json'))).toBe(true);
    expect(existsSync(join(testRoot, 'projects'))).toBe(true);
    expect(existsSync(join(testRoot, 'capsules'))).toBe(true);
    expect(existsSync(join(testRoot, 'logs'))).toBe(true);
  });

  it('should report already initialized on second run', () => {
    execSync(`${CLI} init --root ${testRoot}`, { encoding: 'utf-8' });
    const output = execSync(`${CLI} init --root ${testRoot}`, { encoding: 'utf-8' });
    expect(output).toContain('already initialized');
  });

  it('should reinitialize with --force', () => {
    execSync(`${CLI} init --root ${testRoot}`, { encoding: 'utf-8' });
    const output = execSync(`${CLI} init --root ${testRoot} --force`, { encoding: 'utf-8' });
    expect(output).toContain('Workspace initialized');
  });

  it('should write valid config.json', () => {
    execSync(`${CLI} init --root ${testRoot}`, { encoding: 'utf-8' });
    const raw = readFileSync(join(testRoot, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.version).toBeDefined();
    expect(config.storage.root).toBe(testRoot);
    expect(config.privacy.localOnly).toBe(true);
  });

  it('should show init in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('init');
  });
});
