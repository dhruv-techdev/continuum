import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  claudeCodeAdapter,
  adapterRegistry,
  adapterNormalize,
  EventTypes,
  verifyEventHash,
} from '../src/index';
import type { ContinuumEvent, ToolCallEvent, ToolResultEvent, MessageEvent } from '../src/index';

const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('claudeCodeAdapter.canParse()', () => {
  it('should detect a Claude Code local session log', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    expect(claudeCodeAdapter.canParse(raw)).toBe(true);
  });

  it('should NOT detect a Claude API export', () => {
    const raw = loadFixture('claude-conversation.json');
    expect(claudeCodeAdapter.canParse(raw)).toBe(false);
  });

  it('should NOT detect a ChatGPT export', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    expect(claudeCodeAdapter.canParse(raw)).toBe(false);
  });

  it('should NOT detect plain markdown', () => {
    expect(claudeCodeAdapter.canParse('# User\nHello')).toBe(false);
  });

  it('should be selected by the adapter registry', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const adapter = adapterRegistry.detect(raw, 'session.jsonl');
    expect(adapter?.id).toBe('claude-code');
  });
});

describe('claudeCodeAdapter.parse()', () => {
  it('should extract user and assistant text messages', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    expect(result.detectedProvider).toBe('anthropic');
    const userMsg = result.messages.find((m) => m.role === 'user' && m.content.includes('sample project'));
    expect(userMsg).toBeDefined();

    const assistantMsg = result.messages.find(
      (m) => m.role === 'assistant' && m.content.includes('scaffold'),
    );
    expect(assistantMsg).toBeDefined();
  });

  it('should skip bookkeeping line types', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    // queue-operation / ai-title / last-prompt / file-history-snapshot lines
    // should never surface as parsed messages
    for (const m of result.messages) {
      expect(['user', 'assistant', '__tool_call__', '__tool_result__']).toContain(m.role);
    }
  });

  it('should skip thinking blocks', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    for (const m of result.messages) {
      expect(m.content).not.toContain('signature');
    }
  });

  it('should skip sidechain (subagent) messages', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    const sidechainMsg = result.messages.find((m) => m.content.includes('internal subagent turn'));
    expect(sidechainMsg).toBeUndefined();

    const skipWarning = result.warnings.find((w) => w.message.includes('Sidechain'));
    expect(skipWarning).toBeDefined();
  });

  it('should preserve tool_use callId', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    const toolCall = result.messages.find((m) => m.role === '__tool_call__');
    expect(toolCall).toBeDefined();
    const payload = JSON.parse(toolCall!.content);
    expect(payload.callId).toBe('toolu_01ABC');
    expect(payload.toolName).toBe('Bash');
    expect(payload.input.command).toContain('sample');
  });

  it('should preserve tool_result callId for correlation', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    const toolResult = result.messages.find((m) => m.role === '__tool_result__');
    expect(toolResult).toBeDefined();
    const payload = JSON.parse(toolResult!.content);
    expect(payload.callId).toBe('toolu_01ABC');
    expect(payload.output).toContain('sample-project');
  });

  it('should preserve model info in unmapped fields', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const result = claudeCodeAdapter.parse(raw);

    const assistantMsg = result.messages.find(
      (m) => m.role === 'assistant' && m.unmappedFields.model,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.unmappedFields.model).toContain('claude');
  });

  it('should strip IDE noise tags from user messages', () => {
    const raw = JSON.stringify({
      type: 'user',
      isSidechain: false,
      uuid: 'u1',
      cwd: '/tmp',
      sessionId: 'sess-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<ide_selection>some editor context</ide_selection>What is the capital of France?',
          },
        ],
      },
    });
    const result = claudeCodeAdapter.parse(raw);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('What is the capital of France?');
    expect(result.messages[0].content).not.toContain('ide_selection');
  });

  it('should report malformed lines without crashing', () => {
    const raw = loadFixture('claude-code-session.jsonl') + '\nnot valid json\n';
    const result = claudeCodeAdapter.parse(raw);

    expect(result.warnings.some((w) => w.message.includes('could not be parsed'))).toBe(true);
  });
});

describe('claudeCodeAdapter + adapterNormalize integration', () => {
  it('should produce valid, hash-verified events from a live session log', () => {
    const raw = loadFixture('claude-code-session.jsonl');
    const parseResult = claudeCodeAdapter.parse(raw);

    const { events } = adapterNormalize({
      parseResult,
      projectId: 'proj_test',
      sessionId: 'sess_test',
      source: 'import:claude-code:session.jsonl',
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events as ContinuumEvent[]) {
      expect(verifyEventHash(event)).toBe(true);
    }

    const toolCall = events.find((e) => e.type === EventTypes.TOOL_CALL) as ToolCallEvent | undefined;
    const toolResult = events.find((e) => e.type === EventTypes.TOOL_RESULT) as ToolResultEvent | undefined;
    expect(toolCall?.payload.callId).toBe('toolu_01ABC');
    expect(toolResult?.payload.callId).toBe('toolu_01ABC');

    const message = events.find((e) => e.type === EventTypes.MESSAGE) as MessageEvent | undefined;
    expect(message?.payload.content).toContain('sample project');
  });
});
