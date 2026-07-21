import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  setActiveProject,
  listArtifacts,
} from '@dhruv-techdev/continuum-core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

function runFail(args: string, root: string): string {
  try {
    execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return '';
  } catch (err) {
    return (err as { stderr: string }).stderr || (err as { stdout: string }).stdout || '';
  }
}

describe('continuum artifact', () => {
  let root: string;
  let projectId: string;
  let testFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-artifact-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Artifact CLI Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);

    testFile = join(root, 'main.ts');
    writeFileSync(testFile, 'console.log("hello");', 'utf-8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('register', () => {
    it('should register a file as an artifact', () => {
      const output = run(`artifact register ${testFile} -d "Main entry point"`, root);
      expect(output).toContain('Registered');
      expect(output).toContain('main.ts');
      expect(output).toContain('text/typescript');
      expect(output).toContain('Main entry point');
    });

    it('should register with --store flag to copy content', () => {
      const output = run(`artifact register ${testFile} --store`, root);
      expect(output).toContain('content');
    });

    it('should register a remote URI', () => {
      const output = run('artifact register https://example.com/data.csv', root);
      expect(output).toContain('Registered');
      expect(output).toContain('data.csv');
    });
  });

  describe('list', () => {
    it('should show empty message when no artifacts', () => {
      const output = run('artifact list', root);
      expect(output).toContain('No artifacts');
    });

    it('should list registered artifacts', () => {
      run(`artifact register ${testFile}`, root);

      const f2 = join(root, 'config.json');
      writeFileSync(f2, '{}', 'utf-8');
      run(`artifact register ${f2}`, root);

      const output = run('artifact list', root);
      expect(output).toContain('main.ts');
      expect(output).toContain('config.json');
      expect(output).toContain('2');
    });
  });

  describe('show', () => {
    it('should display artifact details', () => {
      run(`artifact register ${testFile} -d "The main file"`, root);
      const arts = listArtifacts(root, projectId);
      const id = arts[0].id;

      const output = run(`artifact show ${id}`, root);
      expect(output).toContain(id);
      expect(output).toContain('main.ts');
      expect(output).toContain('text/typescript');
      expect(output).toContain('The main file');
    });

    it('should error for nonexistent artifact', () => {
      const output = runFail('artifact show art_nonexistent', root);
      expect(output).toContain('not found');
    });
  });

  describe('delete', () => {
    it('should soft-delete an artifact', () => {
      run(`artifact register ${testFile}`, root);
      const arts = listArtifacts(root, projectId);
      const id = arts[0].id;

      const output = run(`artifact delete ${id}`, root);
      expect(output).toContain('deleted');

      // Should not appear in default list
      const listOutput = run('artifact list', root);
      expect(listOutput).toContain('No artifacts');

      // Should appear with --all
      const allOutput = run('artifact list --all', root);
      expect(allOutput).toContain(id);
    });
  });

  it('should show artifact subcommands in help', () => {
    const output = run('artifact --help', root);
    expect(output).toContain('register');
    expect(output).toContain('list');
    expect(output).toContain('show');
    expect(output).toContain('delete');
  });
});
