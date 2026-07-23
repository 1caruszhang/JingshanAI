export type ProviderApiMode = 'responses' | 'chat_completions' | 'embeddings';

export type DoubaoToolType = 'none' | 'doubao_app' | 'function';

export type DoubaoAppFeature = 'chat' | 'deep_chat' | 'ai_search' | 'reasoning_search';

export type ModelResponseFormat = 'text' | 'json_object' | 'json_schema';

export type ModelRole =
  | 'source_discovery'
  | 'article_generation'
  | 'geo_style_review'
  | 'reflection_validation'
  | 'embedding'
  | 'visibility_check'
  | 'fact_extraction'
  | 'claim_parsing'
  | 'claim_review'
  | 'memory_summary'
  | 'context_compression'
  | 'workflow_planning'
  | 'reflection_candidate'
  | 'agent_runtime'
  | 'question_generation'
  | 'title_generation'
  | 'ranking_theme_selection'
  | 'ranking_article_generation'
  | 'chat';

export type ModelRoute = {
  role: ModelRole;
  provider: 'doubao' | 'deepseek';
  apiMode: ProviderApiMode;
  model: string;
  stream: boolean;
  skill?: string;
  promptVersion?: string;
  toolType?: DoubaoToolType;
  doubaoAppFeature?: DoubaoAppFeature;
  thinking?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: ModelResponseFormat;
  outputSchema?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
};

// 统一输入：调用方不感知具体 provider
//
// role 扩展支持 'tool'（#63 接入 tool_call 循环）：模型发起 tool_call 后，工具
// 执行结果以 role:'tool' 消息回灌。assistant 消息可携带 tool_calls（模型发起
// 的工具调用），tool 消息需带 tool_call_id 对应到发起的 call。
// 各 provider 适配在 modelRouter：DeepSeekMessage 原生支持 tool role/tool_calls/
// tool_call_id；doubao 用宽松的 DoubaoResponseInputItem（Record<string, unknown>）
// 透传 function_call_output。
export type UnifiedChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息携带的 tool_calls（模型发起，OpenAI function-calling 格式）。 */
  tool_calls?: unknown[];
  /** tool 消息对应的 tool_call_id（回灌工具结果时必填）。 */
  tool_call_id?: string;
};

export type UnifiedChatInput = {
  messages: UnifiedChatMessage[];
  tools?: unknown[];
  responseFormat?: ModelResponseFormat;
  outputSchema?: unknown;
  thinking?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  previousResponseId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type UnifiedChatResult = {
  provider: 'doubao' | 'deepseek';
  apiMode: ProviderApiMode;
  model: string;
  responseId?: string;
  previousResponseId?: string;
  content: string;
  reasoningContent?: string;
  toolCalls?: unknown[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  };
  rawResponseJson: unknown;
};

export type UnifiedStreamEvent = {
  provider: 'doubao' | 'deepseek';
  apiMode: ProviderApiMode;
  eventType: string;
  responseId?: string;
  deltaText?: string;
  deltaReasoningContent?: string;
  toolCall?: unknown;
  toolCallDelta?: unknown;
  finishReason?: string;
  usage?: unknown;
  error?: unknown;
  rawEvent: unknown;
};
