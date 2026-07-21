import type {
  DoubaoProviderStreamEvent,
  DoubaoResponseInput,
  DoubaoResponseResult,
} from './types.ts';

function getConfig(): {apiKey: string; baseUrl: string} {
  const apiKey = process.env.ARK_API_KEY;
  const baseUrl = (process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(
    /\/$/,
    '',
  );

  if (!apiKey) {
    throw new Error('ARK_API_KEY not configured');
  }

  return {apiKey, baseUrl};
}

async function toError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  return new Error(
    `Doubao Responses API error: ${response.status} ${response.statusText}\n${text}`,
  );
}

function isDoubaoAppTool(tool: unknown): boolean {
  return typeof tool === 'object' && tool != null && (tool as Record<string, unknown>).type === 'doubao_app';
}

function toolHasRoleDescription(tool: unknown): boolean {
  if (typeof tool !== 'object' || tool == null) return false;
  const feature = (tool as Record<string, unknown>).feature as
    | Record<string, unknown>
    | undefined;
  if (!feature) return false;
  return Object.values(feature).some((cfg) => {
    if (typeof cfg !== 'object' || cfg == null) return false;
    return (
      (cfg as Record<string, unknown>).type === 'enabled' &&
      typeof (cfg as Record<string, unknown>).role_description === 'string'
    );
  });
}

function validateDoubaoInput(input: DoubaoResponseInput): void {
  const doubaoAppTools = input.tools?.filter(isDoubaoAppTool) ?? [];
  if (doubaoAppTools.length === 0) return;

  if (doubaoAppTools.length > 1) {
    throw new Error('Only one doubao_app tool is allowed per request');
  }

  const otherTools = input.tools?.filter((t) => !isDoubaoAppTool(t)) ?? [];
  if (otherTools.length > 0) {
    throw new Error('doubao_app cannot be used with other tools (function calling, web search, etc.)');
  }

  if (input.instructions && doubaoAppTools.some(toolHasRoleDescription)) {
    throw new Error('role_description and instructions are mutually exclusive when using doubao_app');
  }
}

function buildRequestBody(input: DoubaoResponseInput): Record<string, unknown> {
  validateDoubaoInput(input);

  const body: Record<string, unknown> = {
    model: input.model,
    input: input.input,
    stream: input.stream ?? false,
  };

  if (input.instructions) {
    body.instructions = input.instructions;
  }
  if (input.previousResponseId) {
    body.previous_response_id = input.previousResponseId;
  }
  if (input.textFormat) {
    body.text = input.textFormat;
  }
  if (input.outputSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: input.outputSchema.name,
        schema: input.outputSchema.schema,
        strict: input.outputSchema.strict ?? false,
      },
    };
  }
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
  }
  if (input.metadata) {
    body.metadata = input.metadata;
  }
  if (input.thinkingType) {
    body.thinking = {type: input.thinkingType};
  }
  if (input.reasoningEffort) {
    body.reasoning_effort = input.reasoningEffort;
  }

  return body;
}

function extractOutputText(raw: unknown): string {
  if (typeof raw !== 'object' || raw == null) return '';
  const r = raw as Record<string, unknown>;

  // 火山方舟常见字段：output_text 或 output[].content.text
  if (typeof r.output_text === 'string') return r.output_text;

  const output = r.output;
  if (Array.isArray(output)) {
    return output
      .map((item: unknown) => {
        if (typeof item !== 'object' || item == null) return '';
        const i = item as Record<string, unknown>;
        const content = i.content;
        if (typeof content === 'string') return content;
        if (typeof content === 'object' && content != null) {
          const c = content as Record<string, unknown>;
          if (typeof c.text === 'string') return c.text;
        }
        if (typeof i.text === 'string') return i.text;
        return '';
      })
      .join('');
  }

  return '';
}

function mapResponseResult(raw: unknown): DoubaoResponseResult {
  if (typeof raw !== 'object' || raw == null) {
    throw new Error('Invalid Doubao response JSON');
  }
  const r = raw as Record<string, unknown>;
  const usage = (r.usage as Record<string, number>) ?? {};

  return {
    provider: 'doubao',
    apiMode: 'responses',
    responseId: (r.id as string) ?? '',
    previousResponseId: r.previous_response_id as string | undefined,
    model: (r.model as string) ?? '',
    outputText: extractOutputText(raw),
    outputJson: r.output,
    providerUsage: {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens,
      outputTokens: usage.output_tokens ?? usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
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

function mapStreamEvent(raw: Record<string, unknown>): DoubaoProviderStreamEvent {
  const eventType = (raw.type as string) ?? '';
  return {
    provider: 'doubao',
    apiMode: 'responses',
    providerEventType: eventType,
    providerEventId: raw.event_id as string | undefined,
    responseId: raw.response_id as string | undefined,
    outputItemId: raw.item_id as string | undefined,
    toolCallId: raw.tool_call_id as string | undefined,
    deltaText: typeof raw.delta === 'string' ? raw.delta : undefined,
    toolCall: raw.tool_call,
    error: raw.error,
    rawEvent: raw,
  };
}

export async function createResponse(
  input: DoubaoResponseInput,
): Promise<DoubaoResponseResult> {
  const {apiKey, baseUrl} = getConfig();
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...input.extraHeaders,
    },
    body: JSON.stringify(buildRequestBody(input)),
    signal: input.signal,
  });

  if (!response.ok) {
    throw await toError(response);
  }

  const raw = await response.json();
  return mapResponseResult(raw);
}

export async function* streamResponse(
  input: DoubaoResponseInput,
): AsyncGenerator<DoubaoProviderStreamEvent> {
  const {apiKey, baseUrl} = getConfig();
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...input.extraHeaders,
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
