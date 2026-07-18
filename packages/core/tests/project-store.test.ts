import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initWorkspace, createProject, getProject, listProjects } from '../src/index';

describe('project-store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-proj-test-'));
    initWorkspace(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── createProject ───────────────────────────────────────────

  describe('createProject()', () => {
    it('should create a project with generated ID and timestamps', () => {
      const result = createProject(root, { title: 'My Project' });
      expect(result.error).toBeNull();
      expect(result.data).not.toBeNull();

      const p = result.data!;
      expect(p.id).toMatch(/^proj_/);
      expect(p.title).toBe('My Project');
      expect(p.description).toBe('');
      expect(p.createdAt).toMatch(/Z$/);
      expect(p.updatedAt).toBe(p.createdAt);
    });

    it('should persist project.json and sessions/ on disk', () => {
      const result = createProject(root, { title: 'Disk Test' });
      const p = result.data!;

      expect(existsSync(join(root, 'projects', p.id, 'project.json'))).toBe(true);
      expect(existsSync(join(root, 'projects', p.id, 'sessions'))).toBe(true);
    });

    it('should include description when provided', () => {
      const result = createProject(root, {
        title: 'Described',
        description: 'A project with a description',
      });
      expect(result.data!.description).toBe('A project with a description');
    });

    it('should trim whitespace from title and description', () => {
      const result = createProject(root, {
        title: '  Padded Title  ',
        description: '  Padded Desc  ',
      });
      expect(result.data!.title).toBe('Padded Title');
      expect(result.data!.description).toBe('Padded Desc');
    });

    it('should reject empty title', () => {
      const result = createProject(root, { title: '' });
      expect(result.data).toBeNull();
      expect(result.error).toContain('empty');
    });

    it('should reject whitespace-only title', () => {
      const result = createProject(root, { title: '   ' });
      expect(result.data).toBeNull();
      expect(result.error).toContain('empty');
    });

    it('should error when workspace is not initialized', () => {
      const badRoot = join(tmpdir(), 'nonexistent-workspace-' + Date.now());
      const result = createProject(badRoot, { title: 'Orphan' });
      expect(result.data).toBeNull();
      expect(result.error).toContain('continuum init');
    });

    it('should create multiple projects with unique IDs', () => {
      const r1 = createProject(root, { title: 'One' });
      const r2 = createProject(root, { title: 'Two' });
      expect(r1.data!.id).not.toBe(r2.data!.id);
    });
  });

  // ── getProject ──────────────────────────────────────────────

  describe('getProject()', () => {
    it('should retrieve a created project', () => {
      const created = createProject(root, { title: 'Retrieve Me' }).data!;
      const found = getProject(root, created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Retrieve Me');
    });

    it('should return null for nonexistent project', () => {
      expect(getProject(root, 'proj_nonexistent')).toBeNull();
    });

    it('should return null for invalid ID format', () => {
      expect(getProject(root, '../escape')).toBeNull();
    });
  });

  // ── listProjects ────────────────────────────────────────────

  describe('listProjects()', () => {
    it('should return empty array when no projects exist', () => {
      expect(listProjects(root)).toEqual([]);
    });

    it('should return all projects sorted by updatedAt descending', () => {
      createProject(root, { title: 'First' });
      createProject(root, { title: 'Second' });
      createProject(root, { title: 'Third' });

      const list = listProjects(root);
      expect(list).toHaveLength(3);
      // Most recently created (updated) first
      expect(list[0].title).toBe('Third');
      expect(list[2].title).toBe('First');
    });

    it('should not include non-project directories', () => {
      createProject(root, { title: 'Real' });
      // Create a rogue directory
      const { mkdirSync } = require('fs');
      mkdirSync(join(root, 'projects', 'not-a-project'), { recursive: true });

      const list = listProjects(root);
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe('Real');
    });
  });
});
