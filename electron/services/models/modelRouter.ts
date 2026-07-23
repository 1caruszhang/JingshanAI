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

/**
 * 把 UnifiedChatMessage 映射为 doubao Responses API input item。
 *
 * - system/user/assistant：message item。
 * - tool：function_call_output item（role:'tool' 的回灌消息），doubao Responses
 *   API 用 {type:'function_call_output', call_id, output} 形状。call_id 取自
 *   tool_call_id，output 为 content 字符串。
 * - assistant 携带 tool_calls：doubao 用 {type:'function_call', ...}，但当前
 *   md-driven 路径仅在 DeepSeek provider 下走 tool_call 循环（ranking 路由），故
 *   doubao 仅做 best-effort 透传（assistant tool_calls 走宽松 Record 透传）。
 *   provider 差距见 types.ts UnifiedChatMessage 注释。
 */
function toDoubaoInputItem(m: UnifiedChatMessage): DoubaoResponseInputItem {
  if (m.role === 'tool') {
    return {
      type: 'function_call_output',
      call_id: m.tool_call_id,
      output: m.content,
    } as DoubaoResponseInputItem;
  }
  if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
    // best-effort：doubao Responses API 的 function_call item 由循环上下文决定，
    // 这里把 tool_calls 透传到宽松的 Record 形状，由 doubao 客户端处理。
    return {
      type: 'message',
      role: 'assistant',
      content: [{type: 'output_text', text: m.content}],
      tool_calls: m.tool_calls,
    } as DoubaoResponseInputItem;
  }
  return {
    type: 'message',
    role: m.role as 'user' | 'assistant' | 'system',
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
      ...(m.tool_calls ? {tool_calls: m.tool_calls} : {}),
      ...(m.tool_call_id ? {tool_call_id: m.tool_call_id} : {}),
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
      ...(m.tool_calls ? {tool_calls: m.tool_calls} : {}),
      ...(m.tool_call_id ? {tool_call_id: m.tool_call_id} : {}),
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
