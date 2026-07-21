import type {
  DeepSeekChatInput,
  DeepSeekChatResult,
  DeepSeekProviderStreamEvent,
} from './types.ts';

function getConfig(): {apiKey: string; baseUrl: string} {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  return {apiKey, baseUrl};
}

async function toError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  return new Error(`DeepSeek API error: ${response.status} ${response.statusText}\n${text}`);
}

function buildRequestBody(input: DeepSeekChatInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: input.stream ?? false,
  };

  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
  }
  if (input.responseFormat) {
    body.response_format = input.responseFormat;
  }
  if (input.thinking) {
    body.thinking = input.thinking;
  }
  if (input.reasoningEffort) {
    body.reasoning_effort = input.reasoningEffort;
  }
  if (input.maxTokens) {
    body.max_tokens = input.maxTokens;
  }
  if (input.temperature !== undefined) {
    body.temperature = input.temperature;
  }

  return body;
}

function extractContent(raw: unknown): string {
  if (typeof raw !== 'object' || raw == null) return '';
  const r = raw as Record<string, unknown>;
  const choices = r.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = choices[0] as Record<string, unknown>;
  const msg = message.message as Record<string, unknown> | undefined;
  if (typeof msg?.content === 'string') return msg.content;
  return '';
}

function extractReasoningContent(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw == null) return undefined;
  const r = raw as Record<string, unknown>;
  const choices = r.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = choices[0] as Record<string, unknown>;
  const msg = message.message as Record<string, unknown> | undefined;
  if (typeof msg?.reasoning_content === 'string') return msg.reasoning_content;
  return undefined;
}

function extractToolCalls(raw: unknown): unknown[] | undefined {
  if (typeof raw !== 'object' || raw == null) return undefined;
  const r = raw as Record<string, unknown>;
  const choices = r.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = choices[0] as Record<string, unknown>;
  const msg = message.message as Record<string, unknown> | undefined;
  if (Array.isArray(msg?.tool_calls)) return msg.tool_calls as unknown[];
  return undefined;
}

function extractUsage(raw: unknown): DeepSeekChatResult['usage'] {
  if (typeof raw !== 'object' || raw == null) return undefined;
  const r = raw as Record<string, unknown>;
  const usage = r.usage as Record<string, number> | undefined;
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens: usage.cached_tokens ?? usage.prompt_cache_hit_tokens,
  };
}

function mapChatResult(raw: unknown): DeepSeekChatResult {
  if (typeof raw !== 'object' || raw == null) {
    throw new Error('Invalid DeepSeek response JSON');
  }
  const r = raw as Record<string, unknown>;

  return {
    provider: 'deepseek',
    apiMode: 'chat_completions',
    responseId: (r.id as string) ?? '',
    model: (r.model as string) ?? '',
    content: extractContent(raw),
    reasoningContent: extractReasoningContent(raw),
    toolCalls: extractToolCalls(raw),
    usage: extractUsage(raw),
    rawResponseJson: raw,
  };
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractDelta(raw: Record<string, unknown>): DeepSeekProviderStreamEvent['delta'] {
  const choices = raw.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return undefined;
  const delta = choices[0].delta as Record<string, unknown> | undefined;
  if (!delta) return undefined;
  return {
    content: typeof delta.content === 'string' ? delta.content : undefined,
    reasoning_content: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined,
    tool_calls: Array.isArray(delta.tool_calls) ? delta.tool_calls : undefined,
  };
}

function mapStreamEvent(raw: Record<string, unknown>): DeepSeekProviderStreamEvent {
  const choices = raw.choices as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];

  return {
    provider: 'deepseek',
    apiMode: 'chat_completions',
    id: raw.id as string | undefined,
    model: raw.model as string | undefined,
    delta: extractDelta(raw),
    finishReason: firstChoice?.finish_reason as string | undefined,
    usage: raw.usage,
    rawEvent: raw,
  };
}

export async function chatCompletion(input: DeepSeekChatInput): Promise<DeepSeekChatResult> {
  const {apiKey, baseUrl} = getConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(input)),
    signal: input.signal,
  });

  if (!response.ok) {
    throw await toError(response);
  }

  const raw = await response.json();
  return mapChatResult(raw);
}

export async function* streamChatCompletion(
  input: DeepSeekChatInput,
): AsyncGenerator<DeepSeekProviderStreamEvent> {
  const {apiKey, baseUrl} = getConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildRequestBody({...input, stream: true})),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    throw await toError(response);
  }

  for await (const event of parseSse(response.body)) {
    yield mapStreamEvent(event);
  }
}
