import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  defaultConfig,
  validateConfig,
  initWorkspace,
  loadConfig,
  isWorkspaceInitialized,
  WORKSPACE_DIRS,
  CONFIG_FILENAME,
} from '../src/workspace';

describe('defaultConfig()', () => {
  it('should return valid config with correct version', () => {
    const config = defaultConfig('/tmp/test-ws');
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.storage.root).toBe('/tmp/test-ws');
    expect(config.privacy.localOnly).toBe(true);
    expect(config.capture.hashAlgorithm).toBe('sha256');
  });
});

describe('validateConfig()', () => {
  it('should return no errors for a valid config', () => {
    const config = defaultConfig('/tmp/test');
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  it('should reject non-object input', () => {
    const errors = validateConfig('not an object');
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe('root');
  });

  it('should reject null', () => {
    const errors = validateConfig(null);
    expect(errors.length).toBe(1);
  });

  it('should catch invalid version', () => {
    const config = { ...defaultConfig(), version: 'bad' };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === 'version')).toBe(true);
  });

  it('should catch missing storage section', () => {
    const config = { ...defaultConfig() } as Record<string, unknown>;
    delete config.storage;
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === 'storage')).toBe(true);
  });

  it('should catch empty storage root', () => {
    const config = defaultConfig();
    config.storage.root = '';
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === 'storage.root')).toBe(true);
  });

  it('should catch negative maxProjectSizeMB', () => {
    const config = defaultConfig();
    config.storage.maxProjectSizeMB = -1;
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === 'storage.maxProjectSizeMB')).toBe(true);
  });

  it('should catch invalid hashAlgorithm', () => {
    const config = defaultConfig();
    (config.capture as Record<string, unknown>).hashAlgorithm = 'md5';
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === 'capture.hashAlgorithm')).toBe(true);
  });

  it('should catch non-boolean privacy fields', () => {
    const config = defaultConfig();
    (config.privacy as Record<string, unknown>).localOnly = 'yes';
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === 'privacy.localOnly')).toBe(true);
  });
});

describe('initWorkspace()', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'continuum-test-'));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('should create config.json and all subdirectories', () => {
    const result = initWorkspace(testRoot);
    expect(result.errors).toEqual([]);
    expect(result.alreadyExists).toBe(false);
    expect(existsSync(join(testRoot, CONFIG_FILENAME))).toBe(true);

    for (const dir of WORKSPACE_DIRS) {
      expect(existsSync(join(testRoot, dir))).toBe(true);
    }
  });

  it('should write valid JSON config', () => {
    initWorkspace(testRoot);
    const raw = readFileSync(join(testRoot, CONFIG_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(validateConfig(parsed)).toEqual([]);
    expect(parsed.storage.root).toBe(testRoot);
  });

  it('should report alreadyExists on second call', () => {
    initWorkspace(testRoot);
    const result = initWorkspace(testRoot);
    expect(result.alreadyExists).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should create all three workspace directories', () => {
    const result = initWorkspace(testRoot);
    expect(result.dirsCreated).toContain('projects');
    expect(result.dirsCreated).toContain('capsules');
    expect(result.dirsCreated).toContain('logs');
  });
});

describe('loadConfig()', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'continuum-test-'));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('should return error when config does not exist', () => {
    const result = loadConfig(testRoot);
    expect(result.config).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('continuum init');
  });

  it('should load a valid config after init', () => {
    initWorkspace(testRoot);
    const result = loadConfig(testRoot);
    expect(result.errors).toEqual([]);
    expect(result.config).not.toBeNull();
    expect(result.config!.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should return errors for corrupted JSON', () => {
    initWorkspace(testRoot);
    writeFileSync(join(testRoot, CONFIG_FILENAME), '{ bad json !!!', 'utf-8');
    const result = loadConfig(testRoot);
    expect(result.config).toBeNull();
    expect(result.errors[0].message).toContain('Invalid JSON');
  });

  it('should return validation errors for invalid config values', () => {
    initWorkspace(testRoot);
    writeFileSync(
      join(testRoot, CONFIG_FILENAME),
      JSON.stringify({ version: 'bad', storage: {}, capture: {}, privacy: {} }),
      'utf-8',
    );
    const result = loadConfig(testRoot);
    expect(result.config).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('isWorkspaceInitialized()', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'continuum-test-'));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('should return false for empty directory', () => {
    expect(isWorkspaceInitialized(testRoot)).toBe(false);
  });

  it('should return true after init', () => {
    initWorkspace(testRoot);
    expect(isWorkspaceInitialized(testRoot)).toBe(true);
  });
});
