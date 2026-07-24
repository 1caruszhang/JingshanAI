/**
 * contextManager.ts
 *
 * #94: Context Manager 模块 — Agent 对话记忆系统。
 *
 * 核心职责：
 *   - 从 chat_messages 加载指定 session 的最近对话历史
 *   - SlidingWindowStrategy：当历史消息累计 token 超预算时，从最旧的消息开始裁剪
 *   - 当前用户消息始终保留，不受裁剪影响
 *   - sessionId 为空时返回空历史（不报错）
 *
 * #96: SummaryWindowStrategy — 异步摘要（Episodic Memory）
 *   - 对话累计 10 条 user/assistant 消息后，异步生成结构化摘要
 *   - 摘要写入 conversation_summaries 表（summary_type="sliding_window"）
 *   - 幂等：同一批消息范围不产生重复摘要
 *   - 摘要失败不影响对话继续
 *   - getMemoryPreamble() 在下轮对话注入最新摘要
 *
 * 此模块独立于 agent runtime，可注入 mock db 进行单元测试。
 */

import type {getDb} from '../../db/connection.ts';
import {ChatOpenAI} from '@langchain/openai';
import {getDeepseekRoute} from '../models/deepseekModelConfig.ts';

/** 单条历史消息（简化版，仅保留 assemble 所需字段）。 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** ContextManager 配置。 */
export interface ContextManagerConfig {
  /** token 预算上限（默认 4000）。超过此值时从最旧的消息开始裁剪。 */
  maxTokens: number;
  /** 最多保留最近 N 条消息（默认 20）。 */
  maxRecent: number;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  maxTokens: 4000,
  maxRecent: 20,
};

// ── token 估算 ────────────────────────────────────────────────────────────────

/**
 * 简单字符级 token 估算。
 *
 * LLM tokenization 对中文约 1.5–3 chars/token，英文约 3–5 chars/token。
 * 这里取保守值：中文 3 chars/token，英文+CJK 扩展用 4 chars/token。
 * 此函数不追求精确，仅用于滑动窗口的修剪决策。
 */
function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    // CJK Unified Ideographs + Extensions (U+4E00–U+9FFF, U+3400–U+4DBF, U+20000–U+2A6DF)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df)
    ) {
      tokens += 1 / 2.5; // ~2.5 CJK chars per token
    } else if (code > 127) {
      tokens += 1 / 3; // non-ASCII, non-CJK ~3 chars/token
    } else {
      tokens += 1 / 4; // ASCII ~4 chars/token
    }
  }
  return Math.ceil(tokens) || 1;
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * 为指定 session 组装对话上下文。
 *
 * SlidingWindowStrategy：
 *   1. sessionId 为空（undefined/null）→ 返回空数组（不报错）
 *   2. 从 chat_messages 加载最近 maxRecent 条（按 created_at ASC）
 *   3. 累计 token 超过 maxTokens 时，从最旧的消息开始裁剪
 *   4. 当前用户消息不受裁剪，始终保留在最后一次 user message 的位置
 *
 * @param sessionId 会话 ID。为空时返回空数组。
 * @param currentUserMessage 当前用户消息文本（不计入历史，仅用于 token 预算预留）。
 * @param db better-sqlite3 Database 实例（或兼容的 mock）。
 * @param config 可选配置覆盖。
 * @returns 按时间正序排列的历史消息数组。
 */
export function assembleConversationContext(
  sessionId: number | undefined | null,
  currentUserMessage: string,
  db: ReturnType<typeof getDb>,
  config?: Partial<ContextManagerConfig>,
): ConversationMessage[] {
  if (sessionId == null) return [];

  const cfg: ContextManagerConfig = {...DEFAULT_CONFIG, ...config};

  // 1. 加载最近 maxRecent 条历史消息（按时间正序）
  const rawRows = db
    .prepare(
      `SELECT role, content, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(sessionId, cfg.maxRecent) as Array<{
    role: string;
    content: string;
    created_at: string;
  }>;

  if (!Array.isArray(rawRows) || rawRows.length === 0) return [];

  const messages: ConversationMessage[] = rawRows.map((r) => ({
    role: r.role as 'user' | 'assistant',
    content: typeof r.content === 'string' ? r.content : String(r.content ?? ''),
    createdAt: r.created_at,
  }));

  // 2. 计算当前用户消息的 token 预算（始终保留）
  const currentMsgTokens = estimateTokens(currentUserMessage);

  // 3. SlidingWindow：从最旧的消息开始裁剪，直到总 token ≤ maxTokens
  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  // 从数组头部（最旧）开始移除，直到在预算内
  const trimmed = [...messages];
  while (trimmed.length > 0 && totalTokens + currentMsgTokens > cfg.maxTokens) {
    const removed = trimmed.shift()!;
    totalTokens -= estimateTokens(removed.content);
    // 至少保留一条（即不移到空），但若单条消息就超预算，只能保留
    if (trimmed.length === 0) break;
  }

  return trimmed;
}

// ── #96: SummaryWindowStrategy — 异步摘要（Episodic Memory）──────────────────────

/** 触发摘要生成的最小消息数（user + assistant）。 */
const SUMMARY_TRIGGER_COUNT = 10;

/** 摘要 JSON 的预期结构。 */
interface SummaryJson {
  topic?: string;
  progress?: string;
  pending?: string;
  preferences?: string;
}

/**
 * 获取最新摘要作为 memory preamble。
 *
 * 从 conversation_summaries 表读取当前 session 最近一条 sliding_window 摘要，
 * 格式化为 `<memory>...</memory>` 块，供 agent system prompt 前注入。
 *
 * @param sessionId 会话 ID。为空时返回空字符串。
 * @param db better-sqlite3 Database 实例。
 * @returns 格式化的 memory preamble，无摘要时返回空字符串。
 */
export function getMemoryPreamble(
  sessionId: number | undefined | null,
  db: ReturnType<typeof getDb>,
): string {
  if (sessionId == null) return '';

  const row = db
    .prepare(
      `SELECT summary_json FROM conversation_summaries
       WHERE session_id = ? AND summary_type = 'sliding_window'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(sessionId) as {summary_json: string} | undefined;

  if (!row?.summary_json) return '';

  try {
    const s: SummaryJson = JSON.parse(row.summary_json);
    const parts: string[] = [];
    if (s.topic) parts.push(`**讨论主题**: ${s.topic}`);
    if (s.progress) parts.push(`**进展/决策**: ${s.progress}`);
    if (s.pending) parts.push(`**待处理**: ${s.pending}`);
    if (s.preferences) parts.push(`**用户偏好**: ${s.preferences}`);
    if (parts.length === 0) return '';
    return `<memory>\n${parts.join('\n')}\n</memory>\n\n`;
  } catch {
    return '';
  }
}

/**
 * 查找未覆盖摘要的最新消息范围。
 *
 * 返回自上次摘要以来（或从对话开始以来）的 user/assistant 消息，
 * 按 created_at 正序排列，仅返回 role + content + id。
 */
function getMessagesSinceLastSummary(
  sessionId: number,
  db: ReturnType<typeof getDb>,
): Array<{id: number; role: string; content: string}> {
  // 找到最近一次 sliding_window 摘要覆盖到的 message_end_id
  const lastSummary = db
    .prepare(
      `SELECT message_end_id FROM conversation_summaries
       WHERE session_id = ? AND summary_type = 'sliding_window'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(sessionId) as {message_end_id: number | null} | undefined;

  const sinceId = lastSummary?.message_end_id ?? 0;

  return db
    .prepare(
      `SELECT id, role, content FROM chat_messages
       WHERE session_id = ? AND id > ? AND role IN ('user', 'assistant')
       ORDER BY created_at ASC`,
    )
    .all(sessionId, sinceId) as Array<{id: number; role: string; content: string}>;
}

/**
 * 检查给定消息范围是否已有摘要记录（幂等性检查）。
 */
function isRangeAlreadySummarized(
  sessionId: number,
  messageEndId: number,
  db: ReturnType<typeof getDb>,
): boolean {
  const existing = db
    .prepare(
      `SELECT 1 FROM conversation_summaries
       WHERE session_id = ? AND summary_type = 'sliding_window' AND message_end_id = ?`,
    )
    .get(sessionId, messageEndId);
  return existing !== undefined;
}

/**
 * 异步执行摘要生成（内部函数，由 maybeTriggerSummary 在后台调用）。
 *
 * 步骤：
 *   1. 查询自上次摘要以来的新消息
 *   2. 若消息数 < SUMMARY_TRIGGER_COUNT，跳过
 *   3. 幂等检查：该 message_end_id 已有摘要 → 跳过
 *   4. 调用 LLM 生成结构化摘要 JSON
 *   5. 写入 conversation_summaries 表
 */
async function generateSummaryIfNeeded(
  sessionId: number,
  db: ReturnType<typeof getDb>,
  projectId?: number | null,
  taskId?: number,
): Promise<void> {
  const messages = getMessagesSinceLastSummary(sessionId, db);

  // 消息不足，暂不触发
  if (messages.length < SUMMARY_TRIGGER_COUNT) return;

  const startId = messages[0].id;
  const endId = messages[messages.length - 1].id;

  // 幂等检查：同一范围不重复生成
  if (isRangeAlreadySummarized(sessionId, endId, db)) return;

  // 构造 LLM 请求
  const route = getDeepseekRoute('memory_summary');
  if (!route) {
    console.warn('[ContextManager] memory_summary route not configured, skipping summary');
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');

  if (!apiKey) {
    console.warn('[ContextManager] DEEPSEEK_API_KEY not configured, skipping summary');
    return;
  }

  const model = new ChatOpenAI({
    modelName: route.model,
    apiKey,
    configuration: {baseURL},
    temperature: 0.1,
    maxRetries: route.maxRetries ?? 1,
    timeout: route.timeoutMs ?? 90000,
  });

  // 构建 summary prompt
  const conversationText = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 800)}`)
    .join('\n\n');

  const systemPrompt = `你是一个对话摘要助手。请根据以下对话内容，生成一段结构化的摘要 JSON。

要求：
- topic: 讨论的主要主题（1-2句话概括）
- progress: 已达成的决策、进展或成果
- pending: 待处理的后续步骤或未解决的问题
- preferences: 观察到的用户偏好或要求

严格输出 JSON 格式，不要添加任何额外的解释或前缀。所有字段使用中文。

示例输出：
{"topic":"...","progress":"...","pending":"...","preferences":"..."}`;

  const response = await model.invoke([
    {role: 'system', content: systemPrompt},
    {role: 'user', content: `请总结以下对话：\n\n${conversationText}`},
  ]);

  const rawContent =
    typeof response.content === 'string'
      ? response.content.trim()
      : '';

  // 尝试解析 JSON（可能被 markdown 代码块包裹）
  let summaryJson: SummaryJson;
  try {
    // 先尝试直接解析
    summaryJson = JSON.parse(rawContent);
  } catch {
    // 尝试提取 ```json ... ``` 中的内容
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        summaryJson = JSON.parse(jsonMatch[1].trim());
      } catch {
        console.warn('[ContextManager] Failed to parse summary JSON, storing raw content');
        summaryJson = {topic: rawContent.slice(0, 500)};
      }
    } else {
      console.warn('[ContextManager] Failed to parse summary JSON, storing raw content');
      summaryJson = {topic: rawContent.slice(0, 500)};
    }
  }

  // 确保所有字段为字符串
  const sanitized: SummaryJson = {
    topic: typeof summaryJson.topic === 'string' ? summaryJson.topic : undefined,
    progress: typeof summaryJson.progress === 'string' ? summaryJson.progress : undefined,
    pending: typeof summaryJson.pending === 'string' ? summaryJson.pending : undefined,
    preferences: typeof summaryJson.preferences === 'string' ? summaryJson.preferences : undefined,
  };

  const summaryJsonStr = JSON.stringify(sanitized);
  const tokenEstimate = estimateTokens(summaryJsonStr);

  db.prepare(
    `INSERT INTO conversation_summaries (
       session_id, project_id, summary_type,
       message_start_id, message_end_id,
       summary_json, token_estimate,
       model_provider, model_name, prompt_version,
       created_at, updated_at
     ) VALUES (?, ?, 'sliding_window', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    sessionId,
    projectId ?? null,
    startId,
    endId,
    summaryJsonStr,
    tokenEstimate,
    route.provider,
    route.model,
    route.promptVersion ?? null,
  );

  console.log(
    `[ContextManager] Summary generated for session ${sessionId}: ` +
      `messages ${startId}–${endId} (${messages.length} msgs, ${tokenEstimate} tokens est.)`,
  );
}

/**
 * #96: 异步触发摘要生成（fire-and-forget）。
 *
 * 在 agent 回复写入 chat_messages 后调用。内部通过 setImmediate 异步执行，
 * 不阻塞 agent 回复返回给用户。摘要生成失败时仅记录日志，不影响对话。
 *
 * @param sessionId 会话 ID。为空时直接返回。
 * @param db better-sqlite3 Database 实例。
 * @param projectId 可选项目 ID（写入摘要时关联）。
 * @param taskId 可选任务 ID（记录审计）。
 */
export function maybeTriggerSummary(
  sessionId: number | undefined | null,
  db: ReturnType<typeof getDb>,
  projectId?: number | null,
  taskId?: number,
): void {
  if (sessionId == null) return;

  setImmediate(() => {
    generateSummaryIfNeeded(sessionId, db, projectId, taskId).catch((err) => {
      console.error('[ContextManager] Summary generation failed:', err);
    });
  });
}
