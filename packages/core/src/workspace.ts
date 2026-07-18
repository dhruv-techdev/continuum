import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { VERSION } from './index';

// ─── ST1: Workspace and configuration structure ───

export const DEFAULT_ROOT = join(homedir(), '.continuum');

export const WORKSPACE_DIRS = ['projects', 'capsules', 'logs'] as const;

export const CONFIG_FILENAME = 'config.json';

export interface ContinuumConfig {
  version: string;
  storage: {
    root: string;
    maxProjectSizeMB: number;
  };
  capture: {
    excludePatterns: string[];
    hashAlgorithm: 'sha256' | 'sha512';
  };
  privacy: {
    localOnly: boolean;
    secretDetection: boolean;
    redactByDefault: boolean;
  };
}

export function defaultConfig(root: string = DEFAULT_ROOT): ContinuumConfig {
  return {
    version: VERSION,
    storage: {
      root,
      maxProjectSizeMB: 500,
    },
    capture: {
      excludePatterns: ['*.env', '*.pem', '*.key', '*secret*'],
      hashAlgorithm: 'sha256',
    },
    privacy: {
      localOnly: true,
      secretDetection: true,
      redactByDefault: false,
    },
  };
}

// ─── ST3: Validation ───

export interface ValidationError {
  field: string;
  message: string;
}

export function validateConfig(config: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config || typeof config !== 'object') {
    errors.push({ field: 'root', message: 'Configuration must be a JSON object.' });
    return errors;
  }

  const c = config as Record<string, unknown>;

  // version
  if (typeof c.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(c.version)) {
    errors.push({ field: 'version', message: 'Must be a valid semver string (e.g. "0.1.0").' });
  }

  // storage
  if (!c.storage || typeof c.storage !== 'object') {
    errors.push({ field: 'storage', message: 'Missing "storage" section.' });
  } else {
    const s = c.storage as Record<string, unknown>;
    if (typeof s.root !== 'string' || s.root.trim().length === 0) {
      errors.push({ field: 'storage.root', message: 'Must be a non-empty directory path.' });
    }
    if (typeof s.maxProjectSizeMB !== 'number' || s.maxProjectSizeMB <= 0) {
      errors.push({ field: 'storage.maxProjectSizeMB', message: 'Must be a positive number.' });
    }
  }

  // capture
  if (!c.capture || typeof c.capture !== 'object') {
    errors.push({ field: 'capture', message: 'Missing "capture" section.' });
  } else {
    const cap = c.capture as Record<string, unknown>;
    if (!Array.isArray(cap.excludePatterns)) {
      errors.push({ field: 'capture.excludePatterns', message: 'Must be an array of glob strings.' });
    }
    if (!['sha256', 'sha512'].includes(cap.hashAlgorithm as string)) {
      errors.push({ field: 'capture.hashAlgorithm', message: 'Must be "sha256" or "sha512".' });
    }
  }

  // privacy
  if (!c.privacy || typeof c.privacy !== 'object') {
    errors.push({ field: 'privacy', message: 'Missing "privacy" section.' });
  } else {
    const p = c.privacy as Record<string, unknown>;
    if (typeof p.localOnly !== 'boolean') {
      errors.push({ field: 'privacy.localOnly', message: 'Must be true or false.' });
    }
    if (typeof p.secretDetection !== 'boolean') {
      errors.push({ field: 'privacy.secretDetection', message: 'Must be true or false.' });
    }
    if (typeof p.redactByDefault !== 'boolean') {
      errors.push({ field: 'privacy.redactByDefault', message: 'Must be true or false.' });
    }
  }

  return errors;
}

// ─── ST2: Initialization ───

export interface InitResult {
  alreadyExists: boolean;
  root: string;
  configPath: string;
  dirsCreated: string[];
  errors: string[];
}

export function initWorkspace(root: string = DEFAULT_ROOT): InitResult {
  const result: InitResult = {
    alreadyExists: false,
    root,
    configPath: join(root, CONFIG_FILENAME),
    dirsCreated: [],
    errors: [],
  };

  // Check if already initialized
  if (existsSync(result.configPath)) {
    result.alreadyExists = true;
    return result;
  }

  // Create root
  try {
    mkdirSync(root, { recursive: true });
  } catch (err) {
    result.errors.push(`Cannot create workspace root: ${root} — ${(err as Error).message}`);
    return result;
  }

  // Create subdirectories
  for (const dir of WORKSPACE_DIRS) {
    const fullPath = join(root, dir);
    try {
      mkdirSync(fullPath, { recursive: true });
      result.dirsCreated.push(dir);
    } catch (err) {
      result.errors.push(`Cannot create directory "${dir}": ${(err as Error).message}`);
    }
  }

  // Write default config
  try {
    const config = defaultConfig(root);
    writeFileSync(result.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch (err) {
    result.errors.push(`Cannot write config: ${(err as Error).message}`);
  }

  return result;
}

// ─── Read and validate existing config ───

export interface LoadConfigResult {
  config: ContinuumConfig | null;
  errors: ValidationError[];
  raw: string | null;
}

export function loadConfig(root: string = DEFAULT_ROOT): LoadConfigResult {
  const configPath = join(root, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return {
      config: null,
      errors: [{ field: 'config.json', message: `Not found at ${configPath}. Run "continuum init" first.` }],
      raw: null,
    };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    return {
      config: null,
      errors: [{ field: 'config.json', message: `Cannot read: ${(err as Error).message}` }],
      raw: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      config: null,
      errors: [{ field: 'config.json', message: 'Invalid JSON. Fix or delete the file and run "continuum init".' }],
      raw,
    };
  }

  const validationErrors = validateConfig(parsed);
  if (validationErrors.length > 0) {
    return { config: null, errors: validationErrors, raw };
  }

  return { config: parsed as ContinuumConfig, errors: [], raw };
}

export function isWorkspaceInitialized(root: string = DEFAULT_ROOT): boolean {
  const configPath = join(root, CONFIG_FILENAME);
  if (!existsSync(configPath)) return false;

  for (const dir of WORKSPACE_DIRS) {
    if (!existsSync(join(root, dir))) return false;
  }

  return true;
}
