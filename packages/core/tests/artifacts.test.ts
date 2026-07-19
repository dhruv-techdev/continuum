import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  registerArtifact,
  findArtifactById,
  findArtifactByUri,
  listArtifacts,
  linkEventToArtifact,
  deleteArtifact,
  hashFileContent,
  detectMimeType,
  StorageModes,
  ArtifactStatuses,
} from '../src/index';

describe('detectMimeType()', () => {
  it('should detect TypeScript files', () => {
    expect(detectMimeType('app.ts')).toBe('text/typescript');
    expect(detectMimeType('component.tsx')).toBe('text/typescript');
  });

  it('should detect JavaScript files', () => {
    expect(detectMimeType('index.js')).toBe('application/javascript');
  });

  it('should detect JSON files', () => {
    expect(detectMimeType('package.json')).toBe('application/json');
  });

  it('should detect markdown files', () => {
    expect(detectMimeType('README.md')).toBe('text/markdown');
  });

  it('should detect image files', () => {
    expect(detectMimeType('logo.png')).toBe('image/png');
    expect(detectMimeType('photo.jpg')).toBe('image/jpeg');
    expect(detectMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('should detect Python files', () => {
    expect(detectMimeType('script.py')).toBe('text/x-python');
  });

  it('should return octet-stream for unknown extensions', () => {
    expect(detectMimeType('data.xyz')).toBe('application/octet-stream');
  });

  it('should be case-insensitive', () => {
    expect(detectMimeType('FILE.JSON')).toBe('application/json');
    expect(detectMimeType('image.PNG')).toBe('image/png');
  });
});

describe('hashFileContent()', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'continuum-hash-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should produce a 64-char hex string', () => {
    const filePath = join(dir, 'test.txt');
    writeFileSync(filePath, 'hello world', 'utf-8');

    const hash = hashFileContent(filePath);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic', () => {
    const filePath = join(dir, 'test.txt');
    writeFileSync(filePath, 'same content', 'utf-8');

    expect(hashFileContent(filePath)).toBe(hashFileContent(filePath));
  });

  it('should differ for different content', () => {
    const f1 = join(dir, 'a.txt');
    const f2 = join(dir, 'b.txt');
    writeFileSync(f1, 'content A', 'utf-8');
    writeFileSync(f2, 'content B', 'utf-8');

    expect(hashFileContent(f1)).not.toBe(hashFileContent(f2));
  });
});

describe('artifact registry', () => {
  let root: string;
  let projectId: string;
  let testFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-artifact-test-'));
    initWorkspace(root);
    projectId = createProject(root, { title: 'Artifact Test' }).data!.id;

    testFile = join(root, 'test-file.ts');
    writeFileSync(testFile, 'export const hello = "world";', 'utf-8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Registry creation ──────────────────────────────

  describe('ST1 — registerArtifact()', () => {
    it('should register a file and return its entry', () => {
      const result = registerArtifact(root, {
        projectId,
        uri: testFile,
        description: 'Test file',
      });

      expect(result.error).toBeNull();
      expect(result.isUpdate).toBe(false);

      const a = result.artifact!;
      expect(a.id).toMatch(/^art_/);
      expect(a.projectId).toBe(projectId);
      expect(a.fileName).toBe('test-file.ts');
      expect(a.status).toBe(ArtifactStatuses.ACTIVE);
      expect(a.version).toBe(1);
      expect(a.description).toBe('Test file');
    });

    it('should persist to artifacts.json', () => {
      registerArtifact(root, { projectId, uri: testFile });

      const registryPath = join(root, 'projects', projectId, 'artifacts.json');
      expect(existsSync(registryPath)).toBe(true);

      const raw = readFileSync(registryPath, 'utf-8');
      const entries = JSON.parse(raw);
      expect(entries).toHaveLength(1);
    });

    it('should error for nonexistent project', () => {
      const result = registerArtifact(root, {
        projectId: 'proj_nonexistent',
        uri: testFile,
      });
      expect(result.error).toContain('not found');
    });

    it('should register non-existent URIs as reference-only', () => {
      const result = registerArtifact(root, {
        projectId,
        uri: 'https://example.com/data.csv',
      });

      expect(result.error).toBeNull();
      const a = result.artifact!;
      expect(a.size).toBe(0);
      expect(a.hash).toBe('');
      expect(a.storageMode).toBe(StorageModes.REFERENCE);
    });
  });

  // ── ST2: Metadata storage ──────────────────────────────

  describe('ST2 — file metadata', () => {
    it('should detect MIME type from extension', () => {
      const result = registerArtifact(root, { projectId, uri: testFile });
      expect(result.artifact!.mimeType).toBe('text/typescript');
    });

    it('should allow MIME type override', () => {
      const result = registerArtifact(root, {
        projectId,
        uri: testFile,
        mimeType: 'text/plain',
      });
      expect(result.artifact!.mimeType).toBe('text/plain');
    });

    it('should compute file size', () => {
      const result = registerArtifact(root, { projectId, uri: testFile });
      expect(result.artifact!.size).toBeGreaterThan(0);
    });

    it('should compute SHA-256 hash', () => {
      const result = registerArtifact(root, { projectId, uri: testFile });
      expect(result.artifact!.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── ST3: Content vs reference storage ──────────────────

  describe('ST3 — storage modes', () => {
    it('should default to reference-only (no copy)', () => {
      const result = registerArtifact(root, { projectId, uri: testFile });
      expect(result.artifact!.storageMode).toBe(StorageModes.REFERENCE);
      expect(result.artifact!.storedPath).toBeNull();
    });

    it('should copy file content when mode is CONTENT', () => {
      const result = registerArtifact(root, {
        projectId,
        uri: testFile,
        storageMode: StorageModes.CONTENT,
      });

      const a = result.artifact!;
      expect(a.storageMode).toBe(StorageModes.CONTENT);
      expect(a.storedPath).not.toBeNull();

      const storedFullPath = join(root, 'projects', projectId, 'artifacts', a.storedPath!);
      expect(existsSync(storedFullPath)).toBe(true);

      const storedContent = readFileSync(storedFullPath, 'utf-8');
      expect(storedContent).toBe('export const hello = "world";');
    });

    it('should not copy when URI is remote and mode is CONTENT', () => {
      const result = registerArtifact(root, {
        projectId,
        uri: 'https://example.com/file.json',
        storageMode: StorageModes.CONTENT,
      });

      // Can't copy a remote file — should still succeed as reference
      expect(result.artifact!.storedPath).toBeNull();
    });
  });

  // ── Versioning ─────────────────────────────────────────

  describe('versioning', () => {
    it('should skip re-registration when hash matches', () => {
      registerArtifact(root, { projectId, uri: testFile });
      const result = registerArtifact(root, { projectId, uri: testFile });

      expect(result.isUpdate).toBe(false);
      expect(result.artifact!.version).toBe(1);

      // Registry should have exactly 1 entry
      expect(listArtifacts(root, projectId)).toHaveLength(1);
    });

    it('should create new version when content changes', () => {
      registerArtifact(root, { projectId, uri: testFile });

      // Modify the file
      writeFileSync(testFile, 'export const hello = "updated";', 'utf-8');

      const result = registerArtifact(root, { projectId, uri: testFile });
      expect(result.isUpdate).toBe(true);
      expect(result.artifact!.version).toBe(2);

      // Old version should be superseded
      const all = listArtifacts(root, projectId, true);
      const superseded = all.filter((a) => a.status === ArtifactStatuses.SUPERSEDED);
      expect(superseded).toHaveLength(1);
      expect(superseded[0].version).toBe(1);
    });
  });

  // ── Lookup ─────────────────────────────────────────────

  describe('lookups', () => {
    it('should find artifact by ID', () => {
      const reg = registerArtifact(root, { projectId, uri: testFile });
      const found = findArtifactById(root, projectId, reg.artifact!.id);
      expect(found).not.toBeNull();
      expect(found!.uri).toBe(testFile);
    });

    it('should find latest active artifact by URI', () => {
      registerArtifact(root, { projectId, uri: testFile });
      writeFileSync(testFile, 'updated', 'utf-8');
      registerArtifact(root, { projectId, uri: testFile });

      const found = findArtifactByUri(root, projectId, testFile);
      expect(found!.version).toBe(2);
    });

    it('should return null for unknown ID', () => {
      expect(findArtifactById(root, projectId, 'art_nonexistent')).toBeNull();
    });

    it('should return null for unknown URI', () => {
      expect(findArtifactByUri(root, projectId, '/no/such/file')).toBeNull();
    });
  });

  // ── Event linking ──────────────────────────────────────

  describe('event linking', () => {
    it('should link an event to an artifact at registration', () => {
      const result = registerArtifact(root, {
        projectId,
        uri: testFile,
        linkedEventId: 'evt_abc',
      });
      expect(result.artifact!.linkedEventIds).toContain('evt_abc');
    });

    it('should add events via linkEventToArtifact', () => {
      const reg = registerArtifact(root, { projectId, uri: testFile });
      const id = reg.artifact!.id;

      linkEventToArtifact(root, projectId, id, 'evt_111');
      linkEventToArtifact(root, projectId, id, 'evt_222');

      const found = findArtifactById(root, projectId, id);
      expect(found!.linkedEventIds).toContain('evt_111');
      expect(found!.linkedEventIds).toContain('evt_222');
    });

    it('should not duplicate event links', () => {
      const reg = registerArtifact(root, { projectId, uri: testFile });
      const id = reg.artifact!.id;

      linkEventToArtifact(root, projectId, id, 'evt_dup');
      linkEventToArtifact(root, projectId, id, 'evt_dup');

      const found = findArtifactById(root, projectId, id);
      expect(found!.linkedEventIds.filter((e) => e === 'evt_dup')).toHaveLength(1);
    });

    it('should add event link on re-registration with same hash', () => {
      registerArtifact(root, { projectId, uri: testFile, linkedEventId: 'evt_first' });
      registerArtifact(root, { projectId, uri: testFile, linkedEventId: 'evt_second' });

      const found = findArtifactByUri(root, projectId, testFile);
      expect(found!.linkedEventIds).toContain('evt_first');
      expect(found!.linkedEventIds).toContain('evt_second');
    });
  });

  // ── Soft delete ────────────────────────────────────────

  describe('deleteArtifact()', () => {
    it('should mark artifact as deleted', () => {
      const reg = registerArtifact(root, { projectId, uri: testFile });
      const id = reg.artifact!.id;

      const success = deleteArtifact(root, projectId, id);
      expect(success).toBe(true);

      const found = findArtifactById(root, projectId, id);
      expect(found!.status).toBe(ArtifactStatuses.DELETED);
    });

    it('should exclude deleted from default list', () => {
      const reg = registerArtifact(root, { projectId, uri: testFile });
      deleteArtifact(root, projectId, reg.artifact!.id);

      expect(listArtifacts(root, projectId)).toHaveLength(0);
      expect(listArtifacts(root, projectId, true)).toHaveLength(1);
    });

    it('should return false for unknown ID', () => {
      expect(deleteArtifact(root, projectId, 'art_nope')).toBe(false);
    });
  });

  // ── Multiple artifacts ─────────────────────────────────

  describe('multiple artifacts', () => {
    it('should handle multiple files', () => {
      const f2 = join(root, 'other.json');
      writeFileSync(f2, '{"key":"value"}', 'utf-8');

      registerArtifact(root, { projectId, uri: testFile });
      registerArtifact(root, { projectId, uri: f2 });

      const all = listArtifacts(root, projectId);
      expect(all).toHaveLength(2);
      expect(all.map((a) => a.fileName).sort()).toEqual(['other.json', 'test-file.ts']);
    });
  });
});
