import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { initWorkspace, createProject, setActiveProject } from '@continuum/core';

const CLI = `npx tsx ${resolve(__dirname, '../src/index.ts')}`;

function run(args: string, root: string): string {
  return execSync(`${CLI} ${args} --root ${root}`, { encoding: 'utf-8' });
}

describe('continuum track', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-track-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Track CLI Test' }).data!;
    setActiveProject(root, proj.id);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('decision', () => {
    it('should add and list decisions', () => {
      run('track decision add -c "Use TypeScript" -r "Type safety" -a "JavaScript,Python"', root);
      const output = run('track decision list', root);
      expect(output).toContain('Use TypeScript');
      expect(output).toContain('Type safety');
      expect(output).toContain('active');
    });

    it('should reject a decision', () => {
      run('track decision add -c "Use XML"', root);
      const list = run('track decision list --all', root);
      const idMatch = list.match(/dec_[0-9a-f]+/);

      run(`track decision reject ${idMatch![0]} -r "Too verbose"`, root);
      const after = run('track decision list --all', root);
      expect(after).toContain('rejected');
      expect(after).toContain('Too verbose');
    });

    it('should supersede a decision', () => {
      run('track decision add -c "Use SQLite"', root);
      const list = run('track decision list', root);
      const idMatch = list.match(/dec_[0-9a-f]+/);

      run(`track decision supersede ${idMatch![0]} -c "Use JSONL" -r "Simpler"`, root);
      const after = run('track decision list --all', root);
      expect(after).toContain('superseded');
      expect(after).toContain('Use JSONL');
    });
  });

  describe('task', () => {
    it('should add and list tasks', () => {
      run('track task add -d "Implement event schema"', root);
      const output = run('track task list', root);
      expect(output).toContain('Implement event schema');
      expect(output).toContain('pending');
    });

    it('should update task status', () => {
      run('track task add -d "Build ledger"', root);
      const list = run('track task list', root);
      const idMatch = list.match(/task_[0-9a-f]+/);

      run(`track task update ${idMatch![0]} -s completed -n "All tests pass"`, root);
      const after = run('track task list', root);
      expect(after).toContain('completed');
      expect(after).toContain('All tests pass');
    });

    it('should filter by status', () => {
      run('track task add -d "Task A"', root);
      run('track task add -d "Task B"', root);

      const list = run('track task list', root);
      const ids = list.match(/task_[0-9a-f]+/g)!;
      run(`track task update ${ids[0]} -s completed`, root);

      const pending = run('track task list -s pending', root);
      expect(pending).toContain('Task B');
      expect(pending).not.toContain('Task A');
    });
  });

  describe('attempt', () => {
    it('should record and list attempts', () => {
      run('track attempt add -a "Tried SQLite" -o failure -f "ARM linking issues" --observations "Need pure JS"', root);
      const output = run('track attempt list', root);
      expect(output).toContain('Tried SQLite');
      expect(output).toContain('failure');
      expect(output).toContain('ARM linking');
    });

    it('should filter to failures', () => {
      run('track attempt add -a "JSONL approach" -o success', root);
      run('track attempt add -a "Protobuf" -o failure -f "Complex schema evolution"', root);

      const failures = run('track attempt list --failures', root);
      expect(failures).toContain('Protobuf');
      expect(failures).not.toContain('JSONL approach');
    });
  });

  it('should show track subcommands in help', () => {
    const output = run('track --help', root);
    expect(output).toContain('decision');
    expect(output).toContain('task');
    expect(output).toContain('attempt');
  });
});
