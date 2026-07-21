import {getDb} from '../../db/connection.ts';
import {createGeoAgent} from './geoAgentFactory.ts';
import type {AgentTask, AgentTaskStep} from '@/types/domain';

export interface RunMinimalAgentOptions {
  projectId?: number;
  sessionId?: number;
  title?: string;
}

function getLastAiMessageText(state: unknown): string | null {
  if (typeof state !== 'object' || state == null) return null;
  const s = state as Record<string, unknown>;
  const messages = Array.isArray(s.messages) ? s.messages : undefined;
  if (!messages) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (typeof msg !== 'object' || msg == null) continue;
    const m = msg as Record<string, unknown>;
    const type =
      typeof m.type === 'string'
        ? m.type
        : typeof (m as Record<string, unknown>)._getType === 'function'
          ? ((m as Record<string, unknown>)._getType as () => string)()
          : typeof (m as Record<string, unknown>).lc_kwargs === 'object' &&
              (m as Record<string, unknown>).lc_kwargs != null
            ? (((m as Record<string, unknown>).lc_kwargs as Record<string, unknown>).type as string | undefined)
            : undefined;

    if (type === 'ai') {
      const rawContent =
        (m as Record<string, unknown>).content ??
        ((m as Record<string, unknown>).lc_kwargs as Record<string, unknown> | undefined)?.content;
      if (typeof rawContent === 'string') return rawContent;
      if (Array.isArray(rawContent)) {
        return rawContent
          .map((part) => (typeof part === 'string' ? part : (part as {text?: string})?.text ?? ''))
          .join('');
      }
    }
  }

  return null;
}

export async function runMinimalAgentTask(
  userGoal: string,
  options: RunMinimalAgentOptions = {},
): Promise<AgentTask> {
  const db = getDb();
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
    '等待 Agent 回答',
    null,
  );
  const taskId = Number(taskResult.lastInsertRowid);

  const addStep = (
    step: Partial<Omit<AgentTaskStep, 'id' | 'task_id' | 'created_at'>>,
  ): number => {
    const full: Omit<AgentTaskStep, 'id' | 'task_id' | 'created_at'> = {
      parent_step_id: step.parent_step_id ?? null,
      step_type: step.step_type!,
      action_name: step.action_name ?? null,
      status: step.status!,
      input_json: step.input_json ?? null,
      output_json: step.output_json ?? null,
      validation_json: step.validation_json ?? null,
      error_id: step.error_id ?? null,
      attempt_count: step.attempt_count ?? 0,
      max_attempts: step.max_attempts ?? 2,
      started_at: step.started_at ?? null,
      completed_at: step.completed_at ?? null,
    };
    const result = db
      .prepare(
        `INSERT INTO agent_task_steps (
           task_id, parent_step_id, step_type, action_name, status,
           input_json, output_json, validation_json, error_id,
           attempt_count, max_attempts, started_at, completed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        taskId,
        full.parent_step_id,
        full.step_type,
        full.action_name,
        full.status,
        full.input_json,
        full.output_json,
        full.validation_json,
        full.error_id,
        full.attempt_count,
        full.max_attempts,
        full.started_at,
        full.completed_at,
      );
    return Number(result.lastInsertRowid);
  };

  const updateTask = (fields: Partial<AgentTask>): void => {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const setters = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    db.prepare(
      `UPDATE agent_tasks SET ${setters}, updated_at = datetime('now') WHERE id = ?`,
    ).run(...values, taskId);
  };

  const planStepId = addStep({
    step_type: 'plan',
    action_name: 'analyze_user_goal',
    status: 'running',
    input_json: JSON.stringify({userGoal}),
    attempt_count: 1,
    max_attempts: 1,
    started_at: new Date().toISOString(),
  });

  try {
    updateTask({current_objective: '调用 DeepAgent 处理用户问题'});

    const agent = createGeoAgent(options.projectId);
    const userMessage = options.projectId
      ? `当前项目 ID 是 ${options.projectId}。请基于该项目知识库回答：${userGoal}`
      : userGoal;
    const result = await agent.invoke({
      messages: [{role: 'user', content: userMessage}],
    });

    const answerText = getLastAiMessageText(result) ?? 'Agent 未返回有效回答';

    db.prepare(
      `UPDATE agent_task_steps SET status = 'completed', output_json = ?, completed_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify({result: '已生成回答'}), planStepId);

    addStep({
      step_type: 'final_response',
      action_name: 'answer_user',
      status: 'completed',
      input_json: JSON.stringify({userGoal}),
      output_json: JSON.stringify({answer: answerText}),
      attempt_count: 1,
      max_attempts: 1,
      completed_at: new Date().toISOString(),
    });

    db.prepare(
      `INSERT INTO agent_artifacts (
         task_id, project_id, artifact_type, title, content, status, created_at, updated_at
       ) VALUES (?, ?, 'agent_response', ?, ?, 'completed', datetime('now'), datetime('now'))`,
    ).run(taskId, options.projectId ?? null, options.title ?? 'Agent 回答', answerText);

    updateTask({
      status: 'completed',
      current_objective: '已完成回答',
      last_action: 'answer_user',
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[geoAgentRuntime] task ${taskId} failed:`, error);

    db.prepare(
      `UPDATE agent_task_steps SET status = 'failed', output_json = ?, completed_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify({error: message}), planStepId);

    updateTask({
      status: 'failed',
      current_objective: `失败：${message}`,
    });
  }

  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as AgentTask;
}
