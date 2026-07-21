import type {DoubaoProviderStreamEvent} from './types.ts';
import type {AssistantStreamEvent} from '../../assistant/types.ts';

function getStepId(event: DoubaoProviderStreamEvent): string {
  return event.outputItemId ?? event.providerEventId ?? '';
}

function getItemType(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '';
  const item = raw.item as Record<string, unknown> | undefined;
  return (item?.type as string) ?? '';
}

export function mapDoubaoStreamEvent(
  event: DoubaoProviderStreamEvent,
): AssistantStreamEvent | undefined {
  const type = event.providerEventType;
  const raw = event.rawEvent as Record<string, unknown> | undefined;

  switch (type) {
    case 'response.created':
      return {
        type: 'message_start',
        requestId: event.responseId ?? '',
      };

    case 'response.in_progress':
      return {
        type: 'run_progress',
        requestId: event.responseId ?? '',
        status: 'in_progress',
      };

    case 'response.output_item.added': {
      const itemType = getItemType(raw);
      if (itemType === 'tool_call') {
        const item = raw?.item as Record<string, unknown> | undefined;
        return {
          type: 'tool_call_requested',
          toolName: (item?.name as string) ?? '',
          argumentsPreview: item?.arguments ?? {},
          approvalRequired: false,
        };
      }
      return {
        type: 'output_item_added',
        itemId: event.outputItemId ?? event.providerEventId ?? '',
        itemType,
      };
    }

    case 'response.reasoning_summary_part.added':
      return {
        type: 'reasoning_step_start',
        stepId: getStepId(event),
        title: 'reasoning',
      };

    case 'response.reasoning_summary_text.delta':
      return {
        type: 'reasoning_step_delta',
        stepId: getStepId(event),
        delta: event.deltaText ?? '',
      };

    case 'response.output_text.delta':
    case 'response_doubao_app_call_output_text_delta':
      return {
        type: 'text_delta',
        delta: event.deltaText ?? '',
      };

    case 'response.output_text.done':
      return {
        type: 'text_segment_completed',
        text: typeof raw?.text === 'string' ? raw.text : undefined,
        rawEvent: event.rawEvent,
      };

    case 'response_doubao_app_call_output_text_done':
      return {
        type: 'message_text_done',
        text: typeof raw?.text === 'string' ? raw.text : undefined,
        rawEvent: event.rawEvent,
      };

    case 'response_doubao_app_call_search_searching':
      return {
        type: 'search_progress',
        stepId: event.providerEventId ?? '',
        message: '正在联网搜索...',
        rawEvent: event.rawEvent,
      };

    case 'response_doubao_app_call_search_completed':
      return {
        type: 'search_completed',
        stepId: event.providerEventId ?? '',
        resultsSummary: extractSearchSummary(raw),
        rawEvent: event.rawEvent,
      };

    case 'response_doubao_app_call_reasoning_search_completed':
      return {
        type: 'reasoning_search_completed',
        stepId: event.providerEventId ?? '',
        resultsSummary: extractSearchSummary(raw),
        rawEvent: event.rawEvent,
      };

    case 'response_doubao_app_call_reasoning_text_delta':
      return {
        type: 'reasoning_step_delta',
        stepId: event.providerEventId ?? '',
        delta: event.deltaText ?? '',
      };

    case 'response_doubao_app_call_reasoning_text_done':
      return {
        type: 'reasoning_step_completed',
        stepId: event.providerEventId ?? '',
        title: 'reasoning',
      };

    case 'response.tool_call.created':
      return {
        type: 'tool_call_requested',
        toolName: (raw?.name as string) ?? '',
        argumentsPreview: raw?.arguments ?? {},
        approvalRequired: false,
      };

    case 'response.completed':
      return {type: 'message_completed'};

    case 'response.failed':
      return {
        type: 'error',
        message: extractErrorMessage(raw) || 'Responses API returned failed',
        recoverable: true,
        retryable: true,
      };

    case 'response.incomplete':
    case 'response.cancelled':
      return {
        type: 'message_interrupted',
        reason: type,
      };

    default:
      return undefined;
  }
}

function extractSearchSummary(raw: Record<string, unknown> | undefined): string | undefined {
  if (!raw) return undefined;
  if (typeof raw.summary === 'string') return raw.summary;
  if (typeof raw.search_summary === 'string') return raw.search_summary;
  if (typeof raw.answer === 'string') return raw.answer;
  const result = raw.result ?? raw.results;
  if (result) {
    try {
      return JSON.stringify(result);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractErrorMessage(raw: Record<string, unknown> | undefined): string | undefined {
  if (!raw) return undefined;
  if (typeof raw.message === 'string') return raw.message;
  const error = raw.error as Record<string, unknown> | undefined;
  if (typeof error?.message === 'string') return error.message;
  return undefined;
}

export async function* parseDoubaoStream(
  events: AsyncGenerator<DoubaoProviderStreamEvent>,
): AsyncGenerator<AssistantStreamEvent> {
  for await (const event of events) {
    const mapped = mapDoubaoStreamEvent(event);
    if (mapped) yield mapped;
  }
}
