import type {DeepSeekProviderStreamEvent} from './types.ts';
import type {AssistantStreamEvent} from '../../assistant/types.ts';

export function mapDeepSeekStreamEvent(
  event: DeepSeekProviderStreamEvent,
): AssistantStreamEvent | undefined {
  const delta = event.delta;

  if (event.id) {
    // DeepSeek 流式通常每条都带 id，只在第一条发出 message_start
    // 这里用 delta 内容存在性作为首次判断，避免重复发送
    if (delta?.content !== undefined || delta?.reasoning_content !== undefined) {
      // 已在产生内容，不再发 message_start
    }
  }

  if (delta?.reasoning_content) {
    return {
      type: 'reasoning_step_delta',
      stepId: event.id ?? '',
      delta: delta.reasoning_content,
    };
  }

  if (delta?.content) {
    return {
      type: 'text_delta',
      delta: delta.content,
    };
  }

  if (delta?.tool_calls && delta.tool_calls.length > 0) {
    const first = delta.tool_calls[0] as Record<string, unknown>;
    return {
      type: 'tool_call_requested',
      toolName: (first?.function as Record<string, unknown>)?.name as string,
      argumentsPreview: (first?.function as Record<string, unknown>)?.arguments ?? {},
      approvalRequired: false,
    };
  }

  if (event.finishReason) {
    if (event.finishReason === 'stop') {
      return {type: 'message_completed'};
    }
    return {
      type: 'message_interrupted',
      reason: event.finishReason,
    };
  }

  return undefined;
}

export async function* parseDeepSeekStream(
  events: AsyncGenerator<DeepSeekProviderStreamEvent>,
): AsyncGenerator<AssistantStreamEvent> {
  let started = false;

  for await (const event of events) {
    if (!started && event.id) {
      started = true;
      yield {
        type: 'message_start',
        requestId: event.id,
      };
    }

    const mapped = mapDeepSeekStreamEvent(event);
    if (mapped) yield mapped;
  }
}
