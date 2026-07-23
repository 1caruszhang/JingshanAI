/**
 * toolCallLoop.ts
 *
 * runtime tool_call 循环（#60）。在 #59 的隔离上下文基础上加工具调用循环：
 *
 *   模型生成中发起 tool_call
 *     → runtime 暂停生成
 *     → 执行工具（经 TOOL_EXECUTORS 分派，可由 executeWithGuard 包装做 risk gating）
 *     → 工具结果作 tool response 回灌 messages
 *     → 模型继续生成
 *     → 直到无 tool_call，返回最终输出（交 validate）
 *
 * 此模块是纯逻辑层，modelFn 与 executors 全可注入，便于 node:test 集成测试。
 * 不依赖 UnifiedChatMessage 的 tool role 扩展——内部用宽松的 LoopMessage 类型。
 *
 * 暂不接线 runtime——接线在 cutover 票 #62。
 */
import type {ToolExecutor, ToolExecContext, ToolResult} from './toolExecutors.ts';

/** 循环内部的消息类型（比 UnifiedChatMessage 宽松，支持 tool role 与 tool_calls）。 */
export interface LoopMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息携带的 tool_calls（模型发起）。 */
  tool_calls?: ToolCall[];
  /** tool 消息对应的 tool_call_id。 */
  tool_call_id?: string;
}

/** 一次工具调用（模型返回）。 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** modelFn 返回：要么有 content（最终输出），要么有 toolCalls（需执行工具）。 */
export interface ModelFnResult {
  content?: string;
  toolCalls?: ToolCall[];
}

/** 注入的模型函数。接收当前 messages，返回 content 或 toolCalls。 */
export type ModelFn = (messages: LoopMessage[]) => Promise<ModelFnResult>;

/** 工具名 → 执行器映射。 */
export type ToolExecutorMap = Record<string, (args: Record<string, unknown>, ctx: ToolExecContext) => Promise<ToolResult>>;

export interface RunToolCallLoopOptions {
  modelFn: ModelFn;
  /** 工具执行器映射（默认 TOOL_EXECUTORS）。 */
  executors: ToolExecutorMap;
  /** 执行器上下文（DB 依赖注入）。无 tool_call 时可不传。 */
  executorContext?: ToolExecContext;
  /** 初始 messages（system + user）。 */
  initialMessages: LoopMessage[];
  /** 最大循环轮次（每轮一次 modelFn 调用），默认 8。 */
  maxRounds?: number;
  /**
   * 可选的工具执行包装器（如 executeWithGuard 做 risk gating + ledger）。
   * 默认直接调执行器。签名：(name, executor, args, ctx) => Promise<ToolResult>。
   */
  executeTool?: (
    name: string,
    executor: (args: Record<string, unknown>, ctx: ToolExecContext) => Promise<ToolResult>,
    args: Record<string, unknown>,
    ctx: ToolExecContext,
  ) => Promise<ToolResult>;
}

export type ToolCallLoopResult =
  | {ok: true; content: string}
  | {ok: false; error?: string; errors?: string[]};

const DEFAULT_MAX_ROUNDS = 8;

/**
 * 执行 tool_call 循环。
 *
 * 每轮：
 *   1. 调 modelFn(messages) → {content?, toolCalls?}
 *   2. 若 toolCalls 非空：逐个执行工具 → 结果作 tool 消息回灌 → 进下一轮
 *   3. 若 toolCalls 空：返回 content（最终输出）
 *
 * 达到 maxRounds 仍有 tool_call → ok:false。
 * 未知工具名或工具执行失败 → ok:false（失败信息）。
 */
export async function runToolCallLoop(
  opts: RunToolCallLoopOptions,
): Promise<ToolCallLoopResult> {
  const {modelFn, executors, executorContext, initialMessages} = opts;
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const executeTool =
    opts.executeTool ??
    ((_name, executor, args, ctx) => executor(args, ctx));

  const messages: LoopMessage[] = [...initialMessages];

  for (let round = 0; round < maxRounds; round++) {
    const resp = await modelFn(messages);

    // 无 tool_call → 最终输出
    if (!resp.toolCalls || resp.toolCalls.length === 0) {
      if (resp.content === undefined || resp.content === null) {
        return {ok: false, error: '模型未返回 content 也未发起 tool_call'};
      }
      return {ok: true, content: resp.content};
    }

    // 有 tool_call：把 assistant 消息（含 tool_calls）追加到 messages
    messages.push({
      role: 'assistant',
      content: resp.content ?? '',
      tool_calls: resp.toolCalls,
    });

    // 逐个执行工具，结果作 tool 消息回灌
    for (const call of resp.toolCalls) {
      const executor = executors[call.name];
      if (!executor) {
        return {ok: false, errors: [`未知工具：${call.name}`]};
      }
      if (!executorContext) {
        return {ok: false, error: '工具调用需要 executorContext 但未提供'};
      }

      let result: ToolResult;
      try {
        result = await executeTool(call.name, executor, call.args, executorContext);
      } catch (err) {
        return {ok: false, error: `工具 ${call.name} 执行异常：${(err as Error).message}`};
      }

      if (!result.success) {
        return {ok: false, error: `工具 ${call.name} 失败：${result.error ?? '未知错误'}`};
      }

      messages.push({
        role: 'tool',
        content: JSON.stringify(result.result ?? {}),
        tool_call_id: call.id,
      });
    }
  }

  return {ok: false, errors: [`达到最大循环轮次 ${maxRounds} 仍有 tool_call`]};
}
