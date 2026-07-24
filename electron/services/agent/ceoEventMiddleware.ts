/**
 * ceoEventMiddleware.ts
 *
 * #81: CEO 事件流中间件 — 通过 wrapToolCall hook 将 agent 执行过程
 * 实时推送到 Renderer，替代传统的 SQLite 轮询方案。
 *
 * 事件类型：
 *   plan_created         — intent_router 识别出用户意图
 *   subagent_dispatched  — task 工具派发子 agent
 *   subagent_step        — 子 agent 内部工具调用（预留，子 agent 可接入）
 *   subagent_completed   — 子 agent 返回结果
 *   aggregating          — CEO 调用只读工具汇总信息
 *   completed            — 任务完成（含最终回复）
 *   interrupted          — HITL 中断等待用户审批
 *   error                — 任务失败
 */

import type {BrowserWindow} from 'electron';
import {createMiddleware} from 'langchain';
import type {CeoEvent, CeoEventType} from '@/types/domain';

export interface CeoEventMiddlewareOptions {
  taskId: number;
  mainWindow: BrowserWindow | null;
}

/**
 * 需要记录事件的 CEO 工具集合。
 * 不在名单内的工具调用不产生事件（减少噪音）。
 */
const EVENT_TOOLS = new Set([
  'intent_router',
  'task',
  'project_detail',
  'fact_list',
  'article_list',
  'knowledge_list',
  'task_history',
  'kb_search',
  'project_list',
]);

/**
 * 创建 CEO 事件流中间件。
 *
 * 挂载到 createDeepAgent({ middleware: [...] }) 的参数中，
 * 在每次工具调用时通过 BrowserWindow.webContents.send 推送事件到 Renderer。
 */
export function createCeoEventMiddleware(options: CeoEventMiddlewareOptions) {
  const {taskId, mainWindow} = options;

  /** 安全推送事件到 Renderer（忽略窗口销毁/发送失败） */
  function emit(type: CeoEventType, data: CeoEvent['data'] = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const event: CeoEvent = {
        taskId,
        type,
        timestamp: new Date().toISOString(),
        data,
      };
      mainWindow.webContents.send('agentTask:event', event);
    } catch (err) {
      // 窗口可能正在销毁中，静默忽略
    }
  }

  return createMiddleware({
    name: 'ceoEventMiddleware',

    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name;

      // --- 根据工具名判断事件类型 ---
      if (toolName === 'intent_router') {
        emit('plan_created', {
          plan: {
            intent: (request.toolCall.args as Record<string, unknown>)?.user_intent as string,
            skill: (request.toolCall.args as Record<string, unknown>)?.skill as string,
          },
        });
      } else if (toolName === 'task') {
        const args = request.toolCall.args as Record<string, unknown>;
        const subagentType = args?.subagent_type as string;
        const desc = args?.description as string;

        emit('subagent_dispatched', {
          subagent: {name: subagentType, description: desc},
        });

        // 执行子 agent
        const result = await handler(request);

        // 提取子 agent 结果摘要
        const resultContent =
          'content' in result && typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result);

        emit('subagent_completed', {
          result: {
            subagent: subagentType,
            summary: resultContent.slice(0, 500),
            artifactCount: undefined,
          },
        });

        return result;
      } else if (EVENT_TOOLS.has(toolName)) {
        // CEO 只读工具 → aggregating
        emit('aggregating', {
          step: {
            subagent: 'ceo',
            tool: toolName,
            status: 'running',
            input: request.toolCall.args,
          },
        });

        const result = await handler(request);

        emit('aggregating', {
          step: {
            subagent: 'ceo',
            tool: toolName,
            status: 'completed',
            input: request.toolCall.args,
            output: 'content' in result && typeof result.content === 'string' ? result.content.slice(0, 300) : undefined,
          },
        });

        return result;
      }

      // 其他工具：直接执行，不产生事件
      return handler(request);
    },

    // #fix: completed 事件改由 runtime 统一 emit（见 geoAgentDeepAgentRuntime.ts 第 13 步）。
    // afterAgent 在 fallback summary 之前触发，纯 tool call 场景下提取到的 finalReply
    // 为空，提前 emit 会导致 Renderer 收到空回复后卸载组件、UI 空白。
  });
}
