/**
 * geoAgentDeepAgentRuntime.ts
 *
 * Wave 1 DeepAgents 底座接入（#75）—— 用 `createDeepAgent` 替换
 * `runMinimalAgentTask` 作为 `agentTask:run` 的执行入口。
 *
 * 当前阶段使用 mock model（FakeListChatModel），仅验证：
 *   1. createDeepAgent 在 Electron 主进程正常初始化
 *   2. IPC agentTask:run → invoke → 返回结果给 Renderer
 *   3. 与现有 Assistant Runtime 无冲突
 *
 * 后续 ticket（#76 CEO 兜底、#77 Checkpointer、#78+ 各 SubAgent）会
 * 逐步将真实模型、工具集、子 agent 编排接入。
 */

import {createDeepAgent} from 'deepagents';
import type {DeepAgent} from 'deepagents';
import {FakeListChatModel} from '@langchain/core/utils/testing';
import {HumanMessage} from '@langchain/core/messages';
import {getDb} from '../../db/connection.ts';
import {loadSoulAndRule} from '../../prompts/loader.ts';
import type {AgentTask} from '@/types/domain';

export interface RunDeepAgentTaskOptions {
  projectId?: number;
  sessionId?: number;
  title?: string;
}

/**
 * 使用 createDeepAgent + FakeListChatModel 的 mock 入口。
 *
 * 当前阶段：
 *   - model：FakeListChatModel（固定回复 "你好！我是小鲸..."）
 *   - systemPrompt：soul + rule
 *   - tools：无（后续 ticket 逐步接入）
 *   - checkpointer：false（#77 接入 SqliteSaver）
 *
 * 仍写入 agent_tasks 表以保持与 Renderer 的契约兼容。
 */
export async function runDeepAgentTask(
  userGoal: string,
  options: RunDeepAgentTaskOptions = {},
): Promise<AgentTask> {
  const db = getDb();

  // 1. 创建任务记录（保持与旧 runtime 的契约兼容）
  const insertTask = db.prepare(
    `INSERT INTO agent_tasks (
       session_id, project_id, title, user_goal, status,
       current_objective, last_action, risk_level,
       failure_count, loop_count, max_loop_count,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'running', ?, ?, 'low', 0, 0, 12, datetime('now'), datetime('now'))`,
  );

  const taskResult = insertTask.run(
    options.sessionId ?? null,
    options.projectId ?? null,
    options.title ?? userGoal.slice(0, 80),
    userGoal,
    'DeepAgent 分析用户意图',
    null,
  );
  const taskId = Number(taskResult.lastInsertRowid);

  try {
    // 2. mock model：固定回复（#76 将替换为 createAgentModel()）
    const mockModel = new FakeListChatModel({
      responses: [
        `你好！我是小鲸，你的 AI 营销顾问 😊

DeepAgents 底座已成功接入。你发送的消息「${userGoal.slice(0, 60)}${userGoal.length > 60 ? '...' : ''}」已收到。

当前处于 Wave 1 mock 阶段 — 后续 ticket 将逐步接入：
• #76 CEO 兜底（真实模型 + 简单 QA）
• #77 Checkpointer（SQLite 持久化）
• #78+ 各 SubAgent（Knowledge / Fact / Content / Review / Publish）

如有 GEO 或内容营销需求，请随时告诉我！`,
      ],
    });

    // 3. 构建 system prompt（soul + rule）
    const systemPrompt = loadSoulAndRule();

    // 4. 创建 DeepAgent
    const agent: DeepAgent = createDeepAgent({
      name: 'geo-agent-runtime',
      model: mockModel,
      tools: [],
      systemPrompt,
      checkpointer: false,
    });

    // 5. invoke
    const result = await agent.invoke({
      messages: [new HumanMessage(userGoal)],
    });

    // 6. 提取回复文本
    const lastMsg = result.messages?.[result.messages.length - 1];
    const replyText =
      typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content ?? '');

    // 7. 写入 agent response artifact（保持兼容）
    db.prepare(
      `INSERT INTO agent_artifacts (
         task_id, project_id, artifact_type, title, content, status, created_at, updated_at
       ) VALUES (?, ?, 'agent_response', ?, ?, 'completed', datetime('now'), datetime('now'))`,
    ).run(taskId, options.projectId ?? null, 'Agent 回答', replyText);

    // 8. 写入 step 记录
    db.prepare(
      `INSERT INTO agent_task_steps (
         task_id, step_type, action_name, status,
         input_json, output_json, attempt_count, max_attempts,
         started_at, completed_at, created_at
       ) VALUES (?, 'plan', 'deep_agent_invoke', 'completed', ?, ?, 1, 1, datetime('now'), datetime('now'), datetime('now'))`,
    ).run(taskId, JSON.stringify({userGoal}), JSON.stringify({reply: replyText.slice(0, 500)}));

    // 9. 如果有关联 session，写入 chat_messages
    if (options.sessionId) {
      db.prepare(
        `INSERT INTO chat_messages (session_id, project_id, role, content, created_at)
         VALUES (?, ?, 'assistant', ?, datetime('now'))`,
      ).run(options.sessionId, options.projectId ?? null, replyText);
    }

    // 10. 更新任务为 completed
    db.prepare(
      `UPDATE agent_tasks SET status = 'completed', current_objective = 'DeepAgent 已完成',
       last_action = 'deep_agent_invoke', completed_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[geoAgentDeepAgentRuntime] task ${taskId} failed:`, error);

    db.prepare(
      `UPDATE agent_tasks SET status = 'failed',
       current_objective = ?,
       updated_at = datetime('now') WHERE id = ?`,
    ).run(`失败：${message}`, taskId);

    db.prepare(
      `INSERT INTO agent_task_steps (
         task_id, step_type, action_name, status,
         input_json, output_json, attempt_count, max_attempts,
         started_at, completed_at, created_at
       ) VALUES (?, 'plan', 'deep_agent_invoke', 'failed', ?, ?, 1, 1, datetime('now'), datetime('now'), datetime('now'))`,
    ).run(taskId, JSON.stringify({userGoal}), JSON.stringify({error: message}));
  }

  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as AgentTask;
}
