export type DeepSeekMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type DeepSeekMessage = {
  role: DeepSeekMessageRole;
  content?: string | null;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type DeepSeekResponseFormat = {type: 'json_object'};

export type DeepSeekChatInput = {
  model: string;
  messages: DeepSeekMessage[];
  stream?: boolean;
  tools?: unknown[];
  responseFormat?: DeepSeekResponseFormat;
  thinking?: {type: 'enabled' | 'disabled'};
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type DeepSeekChatResult = {
  provider: 'deepseek';
  apiMode: 'chat_completions';
  responseId: string;
  model: string;
  content: string;
  reasoningContent?: string;
  toolCalls?: unknown[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedTokens?: number;
  };
  rawResponseJson: unknown;
};

export type DeepSeekProviderStreamEvent = {
  provider: 'deepseek';
  apiMode: 'chat_completions';
  id?: string;
  model?: string;
  delta?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: unknown[];
  };
  finishReason?: string;
  usage?: unknown;
  rawEvent: unknown;
};
