import type {
  ModelRole,
  ModelRoute,
  UnifiedChatInput,
  UnifiedChatMessage,
  UnifiedChatResult,
  UnifiedStreamEvent,
} from './types.ts';
import {chatCompletion, streamChatCompletion} from './deepseek/deepseekClient.ts';
import {createResponse, streamResponse} from './doubao/doubaoResponsesClient.ts';
import type {DoubaoResponseInputItem} from './doubao/types.ts';
import {buildDoubaoAppTool, getDoubaoAssistantBetaHeader, getDoubaoAssistantRoleDescription} from './doubao/doubaoAppTool.ts';
import {getDeepseekRoute} from './deepseekModelConfig.ts';
import {getDoubaoRoute} from './modelConfig.ts';

export function getRoute(role: ModelRole): ModelRoute {
  const route = getDoubaoRoute(role) ?? getDeepseekRoute(role);
  if (!route) {
    throw new Error(`No model route configured for role: ${role}`);
  }
  return route;
}

// 保留旧命名兼容
export const modelRouter = getRoute;

function toDoubaoInputItem(m: UnifiedChatMessage): DoubaoResponseInputItem {
  return {
    type: 'message',
    role: m.role,
    content: [{type: 'input_text', text: m.content}],
  };
}

function buildDoubaoTools(route: ModelRoute): unknown[] | undefined {
  if (route.toolType === 'doubao_app' && route.doubaoAppFeature) {
    return [buildDoubaoAppTool(route.doubaoAppFeature, getDoubaoAssistantRoleDescription())];
  }
  return undefined;
}

function pickDoubaoExtraHeaders(route: ModelRoute): Record<string, string> | undefined {
  if (route.toolType === 'doubao_app') {
    return getDoubaoAssistantBetaHeader();
  }
  return undefined;
}

export async function executeText(
  role: ModelRole,
  input: UnifiedChatInput,
): Promise<UnifiedChatResult> {
  const route = getRoute(role);

  if (route.provider === 'doubao') {
    const systemMessage = input.messages.find((m) => m.role === 'system');
    const conversationMessages = input.messages.filter((m) => m.role !== 'system');

    const result = await createResponse({
      model: route.model,
      instructions: systemMessage?.content,
      input: conversationMessages.map(toDoubaoInputItem),
      stream: false,
      previousResponseId: input.previousResponseId,
      tools: input.tools ?? buildDoubaoTools(route),
      outputSchema: input.responseFormat === 'json_schema' ? (input.outputSchema as {name: string; schema: unknown; strict?: boolean}) : undefined,
      textFormat: input.responseFormat === 'json_object' ? {format: {type: 'json_object'}} : undefined,
      thinkingType: input.thinking ? 'enabled' : route.thinking ? 'enabled' : undefined,
      reasoningEffort: input.reasoningEffort ?? route.reasoningEffort,
      metadata: input.metadata,
      extraHeaders: pickDoubaoExtraHeaders(route),
      signal: input.signal,
    });

    return {
      provider: 'doubao',
      apiMode: 'responses',
      model: result.model,
      responseId: result.responseId,
      previousResponseId: result.previousResponseId,
      content: result.outputText ?? '',
      usage: result.providerUsage
        ? {
            inputTokens: result.providerUsage.inputTokens ?? 0,
            outputTokens: result.providerUsage.outputTokens ?? 0,
            totalTokens: result.providerUsage.totalTokens,
          }
        : undefined,
      rawResponseJson: result.rawResponseJson,
    };
  }

  // DeepSeek chat_completions
  const result = await chatCompletion({
    model: route.model,
    messages: input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: false,
    tools: input.tools,
    responseFormat: input.responseFormat === 'json_object' ? {type: 'json_object'} : undefined,
    thinking: input.thinking ? {type: 'enabled'} : route.thinking ? {type: 'enabled'} : undefined,
    reasoningEffort: input.reasoningEffort ?? route.reasoningEffort,
    signal: input.signal,
  });

  return {
    provider: 'deepseek',
    apiMode: 'chat_completions',
    model: result.model,
    responseId: result.responseId,
    content: result.content,
    reasoningContent: result.reasoningContent,
    toolCalls: result.toolCalls,
    usage: result.usage
      ? {
          inputTokens: result.usage.promptTokens ?? 0,
          outputTokens: result.usage.completionTokens ?? 0,
          totalTokens: result.usage.totalTokens,
        }
      : undefined,
    rawResponseJson: result.rawResponseJson,
  };
}

export async function* executeStream(
  role: ModelRole,
  input: UnifiedChatInput,
): AsyncGenerator<UnifiedStreamEvent> {
  const route = getRoute(role);

  if (route.provider === 'doubao') {
    const systemMessage = input.messages.find((m) => m.role === 'system');
    const conversationMessages = input.messages.filter((m) => m.role !== 'system');

    const streamInput = {
      model: route.model,
      instructions: systemMessage?.content,
      input: conversationMessages.map(toDoubaoInputItem),
      stream: true,
      previousResponseId: input.previousResponseId,
      tools: input.tools ?? buildDoubaoTools(route),
      outputSchema: input.responseFormat === 'json_schema' ? (input.outputSchema as {name: string; schema: unknown; strict?: boolean}) : undefined,
      textFormat: input.responseFormat === 'json_object' ? {format: {type: 'json_object'}} : undefined,
      thinkingType: input.thinking ? 'enabled' : route.thinking ? 'enabled' : undefined,
      reasoningEffort: input.reasoningEffort ?? route.reasoningEffort,
      metadata: input.metadata,
      extraHeaders: pickDoubaoExtraHeaders(route),
      signal: input.signal,
    };

    for await (const event of streamResponse(streamInput)) {
      yield {
        provider: 'doubao',
        apiMode: 'responses',
        eventType: event.providerEventType,
        responseId: event.responseId,
        deltaText: event.deltaText,
        toolCall: event.toolCall,
        error: event.error,
        rawEvent: event.rawEvent,
      };
    }
    return;
  }

  const stream = streamChatCompletion({
    model: route.model,
    messages: input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: true,
    tools: input.tools,
    responseFormat: input.responseFormat === 'json_object' ? {type: 'json_object'} : undefined,
    thinking: input.thinking ? {type: 'enabled'} : route.thinking ? {type: 'enabled'} : undefined,
    reasoningEffort: input.reasoningEffort ?? route.reasoningEffort,
    signal: input.signal,
  });

  for await (const event of stream) {
    yield {
      provider: 'deepseek',
      apiMode: 'chat_completions',
      eventType: 'delta',
      responseId: event.id,
      deltaText: event.delta?.content,
      deltaReasoningContent: event.delta?.reasoning_content,
      toolCallDelta: event.delta?.tool_calls,
      finishReason: event.finishReason,
      usage: event.usage,
      rawEvent: event.rawEvent,
    };
  }
}
