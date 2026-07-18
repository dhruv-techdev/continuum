import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { initWorkspace, createProject, setActiveProject } from '@continuum/core';

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

describe('continuum import', () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-cli-import-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Import CLI Test' }).data!;
    projectId = proj.id;
    setActiveProject(root, projectId);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should import a JSON transcript', () => {
    const filePath = join(root, 'transcript.json');
    writeFileSync(
      filePath,
      JSON.stringify([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]),
      'utf-8',
    );

    const output = run(`import ${filePath}`, root);

    expect(output).toContain('Transcript imported');
    expect(output).toContain('Events:    2 created');
    expect(output).toContain('json');
  });

  it('should import a Markdown transcript', () => {
    const filePath = join(root, 'transcript.md');
    writeFileSync(
      filePath,
      `## User\nWhat is TypeScript?\n\n## Assistant\nTypeScript is a typed superset of JavaScript.`,
      'utf-8',
    );

    const output = run(`import ${filePath}`, root);

    expect(output).toContain('Transcript imported');
    expect(output).toContain('Events:    2 created');
    expect(output).toContain('markdown');
  });

  it('should show warnings for unmapped fields', () => {
    const filePath = join(root, 'rich.json');
    writeFileSync(
      filePath,
      JSON.stringify([
        { role: 'user', content: 'hi', tool_calls: [{ name: 'test' }] },
      ]),
      'utf-8',
    );

    const output = run(`import ${filePath} --verbose`, root);

    expect(output).toContain('Warnings:');
    expect(output).toContain('tool_calls');
  });

  it('should error for nonexistent file', () => {
    const output = runFail('import /nonexistent/file.json', root);
    expect(output).toContain('not found');
  });

  it('should error when no project is active', () => {
    setActiveProject(root, null);
    const filePath = join(root, 'test.json');
    writeFileSync(filePath, JSON.stringify([{ role: 'user', content: 'hi' }]), 'utf-8');

    const output = runFail(`import ${filePath}`, root);
    expect(output).toContain('No active project');
  });

  it('should import a wrapped JSON format', () => {
    const filePath = join(root, 'wrapped.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        messages: [
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'two' },
        ],
        title: 'My Chat',
      }),
      'utf-8',
    );

    const output = run(`import ${filePath}`, root);
    expect(output).toContain('Events:    2 created');
  });

  it('should detect provider for ChatGPT format', () => {
    const filePath = join(root, 'chatgpt.json');
    writeFileSync(
      filePath,
      JSON.stringify({
        mapping: {
          'n1': {
            message: {
              author: { role: 'user' },
              content: { parts: ['Hello'] },
              create_time: 100,
            },
          },
          'n2': {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Hi'] },
              create_time: 200,
            },
          },
        },
      }),
      'utf-8',
    );

    const output = run(`import ${filePath}`, root);
    expect(output).toContain('openai (detected)');
    expect(output).toContain('Events:    2 created');
  });

  it('should show help text in --help', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' });
    expect(output).toContain('import');
  });
});
