/**
 * Adapter-aware normalizer.
 *
 * Extends the base normalizer to handle special role markers
 * from provider-specific adapters:
 *   __tool_call__  → EventTypes.TOOL_CALL
 *   __tool_result__ → EventTypes.TOOL_RESULT
 */

import { createEvent, EventTypes, MessageRoles } from '../events/index';
import type { ContinuumEvent, MessageRole } from '../events/types';
import type { ParseResult, ImportWarning } from '../import/types';
import { WarningTypes } from '../import/types';

const ROLE_MAP: Record<string, MessageRole> = {
  user: MessageRoles.USER,
  assistant: MessageRoles.ASSISTANT,
  system: MessageRoles.SYSTEM,
};

export interface AdapterNormalizeInput {
  parseResult: ParseResult;
  projectId: string;
  sessionId: string;
  source: string;
}

export interface AdapterNormalizeOutput {
  events: ContinuumEvent[];
  warnings: ImportWarning[];
  stats: {
    totalParsed: number;
    messagesCreated: number;
    toolCallsCreated: number;
    toolResultsCreated: number;
    skipped: number;
  };
}

export function adapterNormalize(input: AdapterNormalizeInput): AdapterNormalizeOutput {
  const { parseResult, projectId, sessionId, source } = input;
  const warnings: ImportWarning[] = [...parseResult.warnings];
  const events: ContinuumEvent[] = [];
  let skipped = 0;
  let messagesCreated = 0;
  let toolCallsCreated = 0;
  let toolResultsCreated = 0;

  for (let i = 0; i < parseResult.messages.length; i++) {
    const msg = parseResult.messages[i];

    // Tool call from adapter
    if (msg.role === '__tool_call__') {
      try {
        const payload = JSON.parse(msg.content);
        const event = createEvent({
          type: EventTypes.TOOL_CALL,
          projectId,
          sessionId,
          sequence: i,
          source,
          payload: {
            toolName: payload.toolName,
            input: payload.input ?? {},
            callId: payload.callId,
          },
        });
        events.push(event);
        toolCallsCreated++;
      } catch {
        warnings.push({
          type: WarningTypes.SKIPPED_MESSAGE,
          field: `[${i}]`,
          message: `Could not parse tool_call payload at index ${i}. Skipped.`,
          messageIndex: i,
        });
        skipped++;
      }
      continue;
    }

    // Tool result from adapter
    if (msg.role === '__tool_result__') {
      try {
        const payload = JSON.parse(msg.content);
        const event = createEvent({
          type: EventTypes.TOOL_RESULT,
          projectId,
          sessionId,
          sequence: i,
          source,
          payload: {
            toolName: payload.toolName ?? 'unknown',
            output: payload.output ?? '',
            callId: payload.callId,
            isError: payload.isError ?? false,
          },
        });
        events.push(event);
        toolResultsCreated++;
      } catch {
        warnings.push({
          type: WarningTypes.SKIPPED_MESSAGE,
          field: `[${i}]`,
          message: `Could not parse tool_result payload at index ${i}. Skipped.`,
          messageIndex: i,
        });
        skipped++;
      }
      continue;
    }

    // Regular message
    const role = ROLE_MAP[msg.role];
    if (!role) {
      warnings.push({
        type: WarningTypes.COERCED,
        field: `[${i}].role`,
        message: `Unknown role "${msg.role}" coerced to "user".`,
        messageIndex: i,
      });
    }

    const metadata: Record<string, unknown> = {};
    if (Object.keys(msg.unmappedFields).length > 0) {
      metadata.originalFields = msg.unmappedFields;
    }
    if (!ROLE_MAP[msg.role]) {
      metadata.originalRole = msg.role;
    }
    if (parseResult.detectedProvider) {
      metadata.detectedProvider = parseResult.detectedProvider;
    }

    const event = createEvent({
      type: EventTypes.MESSAGE,
      projectId,
      sessionId,
      sequence: i,
      source,
      payload: {
        role: role ?? MessageRoles.USER,
        content: msg.content,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
    });

    events.push(event);
    messagesCreated++;
  }

  return {
    events,
    warnings,
    stats: {
      totalParsed: parseResult.messages.length,
      messagesCreated,
      toolCallsCreated,
      toolResultsCreated,
      skipped,
    },
  };
}
