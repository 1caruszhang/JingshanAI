import type {AssistantToolCall} from '@/types/domain';

export async function createToolCall(_runId: number, _toolName: string, _args: unknown): Promise<AssistantToolCall> {
  throw new Error('ToolCallService.createToolCall not implemented');
}

export async function resolveToolCall(_toolCallId: number, _result: unknown): Promise<void> {
  throw new Error('ToolCallService.resolveToolCall not implemented');
}
