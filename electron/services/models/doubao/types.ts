export type DoubaoResponseInputText = {type: 'input_text'; text: string};

export type DoubaoResponseInputImage = {type: 'input_image'; image_url: string};

export type DoubaoResponseInputItem =
  | {
      type: 'message';
      role: 'user' | 'assistant' | 'system';
      content: Array<DoubaoResponseInputText | DoubaoResponseInputImage | string>;
    }
  | Record<string, unknown>;

export type DoubaoResponseOutputSchema = {
  name: string;
  schema: unknown;
  strict?: boolean;
};

export type DoubaoResponseInput = {
  model: string;
  input: DoubaoResponseInputItem[];
  instructions?: string;
  stream?: boolean;
  previousResponseId?: string;
  textFormat?: unknown;
  outputSchema?: DoubaoResponseOutputSchema;
  tools?: unknown[];
  metadata?: Record<string, unknown>;
  thinkingType?: string;
  reasoningEffort?: string;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
};

export type DoubaoResponseResult = {
  provider: 'doubao';
  apiMode: 'responses';
  responseId: string;
  previousResponseId?: string;
  model: string;
  outputText?: string;
  outputJson?: unknown;
  providerUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  rawResponseJson: unknown;
};

export type DoubaoProviderStreamEvent = {
  provider: 'doubao';
  apiMode: 'responses';
  providerEventId?: string;
  providerEventType: string;
  responseId?: string;
  outputItemId?: string;
  toolCallId?: string;
  deltaText?: string;
  toolCall?: unknown;
  error?: unknown;
  rawEvent: unknown;
};
