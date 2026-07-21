import { dbApi } from '../lib/electron-api';
import type { AgentTask, AgentTaskStep, AgentArtifact } from '../types/domain';

export const agentTaskService = {
  async getByProject(projectId: number): Promise<AgentTask[]> {
    return dbApi.query(
      `SELECT id, session_id, project_id, title, user_goal, status,
              current_objective, last_action, risk_level, allowed_actions_json,
              context_snapshot_json, budget_json, usage_json, failure_count,
              loop_count, max_loop_count, created_at, updated_at, completed_at
       FROM agent_tasks
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    ) as Promise<AgentTask[]>;
  },

  async getById(id: number): Promise<AgentTask | undefined> {
    const rows = (await dbApi.query(
      `SELECT id, session_id, project_id, title, user_goal, status,
              current_objective, last_action, risk_level, allowed_actions_json,
              context_snapshot_json, budget_json, usage_json, failure_count,
              loop_count, max_loop_count, created_at, updated_at, completed_at
       FROM agent_tasks
       WHERE id = ?`,
      [id],
    )) as AgentTask[];
    return rows[0];
  },

  async create(
    data: Omit<
      AgentTask,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'completed_at'
      | 'status'
      | 'failure_count'
      | 'loop_count'
      | 'max_loop_count'
    >,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO agent_tasks (
         session_id, project_id, title, user_goal, status,
         current_objective, last_action, risk_level, allowed_actions_json,
         context_snapshot_json, budget_json, usage_json,
         failure_count, loop_count, max_loop_count,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, 0, 0, 12, datetime('now'), datetime('now'))`,
      [
        data.session_id ?? null,
        data.project_id ?? null,
        data.title ?? null,
        data.user_goal,
        data.current_objective ?? null,
        data.last_action ?? null,
        data.risk_level ?? null,
        data.allowed_actions_json ?? null,
        data.context_snapshot_json ?? null,
        data.budget_json ?? null,
        data.usage_json ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async update(
    id: number,
    data: Partial<Omit<AgentTask, 'id' | 'created_at'>>,
  ): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];

    const addField = (name: keyof AgentTask, value: unknown) => {
      if (value !== undefined) {
        fields.push(`${name} = ?`);
        params.push(value);
      }
    };

    addField('session_id', data.session_id);
    addField('project_id', data.project_id);
    addField('title', data.title);
    addField('user_goal', data.user_goal);
    addField('status', data.status);
    addField('current_objective', data.current_objective);
    addField('last_action', data.last_action);
    addField('risk_level', data.risk_level);
    addField('allowed_actions_json', data.allowed_actions_json);
    addField('context_snapshot_json', data.context_snapshot_json);
    addField('budget_json', data.budget_json);
    addField('usage_json', data.usage_json);
    addField('failure_count', data.failure_count);
    addField('loop_count', data.loop_count);
    addField('max_loop_count', data.max_loop_count);
    addField('completed_at', data.completed_at);

    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    params.push(id);

    await dbApi.exec(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`, params);
  },

  async getSteps(taskId: number): Promise<AgentTaskStep[]> {
    return dbApi.query(
      `SELECT id, task_id, parent_step_id, step_type, action_name, status,
              input_json, output_json, validation_json, error_id,
              attempt_count, max_attempts, started_at, completed_at, created_at
       FROM agent_task_steps
       WHERE task_id = ?
       ORDER BY created_at ASC`,
      [taskId],
    ) as Promise<AgentTaskStep[]>;
  },

  async addStep(
    data: Omit<AgentTaskStep, 'id' | 'created_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO agent_task_steps (
         task_id, parent_step_id, step_type, action_name, status,
         input_json, output_json, validation_json, error_id,
         attempt_count, max_attempts, started_at, completed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        data.task_id,
        data.parent_step_id ?? null,
        data.step_type,
        data.action_name ?? null,
        data.status,
        data.input_json ?? null,
        data.output_json ?? null,
        data.validation_json ?? null,
        data.error_id ?? null,
        data.attempt_count,
        data.max_attempts,
        data.started_at ?? null,
        data.completed_at ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async getArtifacts(taskId: number): Promise<AgentArtifact[]> {
    return dbApi.query(
      `SELECT id, task_id, project_id, artifact_type, title, content,
              metadata_json, status, created_at, updated_at
       FROM agent_artifacts
       WHERE task_id = ?
       ORDER BY created_at DESC`,
      [taskId],
    ) as Promise<AgentArtifact[]>;
  },
};
