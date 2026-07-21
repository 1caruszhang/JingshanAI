import { dbApi } from '../lib/electron-api';
import type { AgentArtifact } from '../types/domain';

export const draftService = {
  async getByTask(taskId: number): Promise<AgentArtifact[]> {
    return dbApi.query(
      `SELECT id, task_id, project_id, artifact_type, title, content,
              metadata_json, status, created_at, updated_at
       FROM agent_artifacts
       WHERE task_id = ?
       ORDER BY created_at DESC`,
      [taskId],
    ) as Promise<AgentArtifact[]>;
  },

  async getByProject(projectId: number): Promise<AgentArtifact[]> {
    return dbApi.query(
      `SELECT id, task_id, project_id, artifact_type, title, content,
              metadata_json, status, created_at, updated_at
       FROM agent_artifacts
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    ) as Promise<AgentArtifact[]>;
  },

  async getById(id: number): Promise<AgentArtifact | undefined> {
    const rows = (await dbApi.query(
      `SELECT id, task_id, project_id, artifact_type, title, content,
              metadata_json, status, created_at, updated_at
       FROM agent_artifacts
       WHERE id = ?`,
      [id],
    )) as AgentArtifact[];
    return rows[0];
  },

  async create(
    data: Omit<AgentArtifact, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO agent_artifacts (
         task_id, project_id, artifact_type, title, content,
         metadata_json, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        data.task_id ?? null,
        data.project_id,
        data.artifact_type,
        data.title ?? null,
        data.content ?? null,
        data.metadata_json ?? null,
        data.status ?? 'draft',
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async updateArtifact(id: number, content: string): Promise<void> {
    await dbApi.exec(
      `UPDATE agent_artifacts
       SET content = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [content, id],
    );
  },

  async update(
    id: number,
    data: Partial<Omit<AgentArtifact, 'id' | 'created_at'>>,
  ): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];

    const addField = (name: keyof AgentArtifact, value: unknown) => {
      if (value !== undefined) {
        fields.push(`${name} = ?`);
        params.push(value);
      }
    };

    addField('task_id', data.task_id);
    addField('project_id', data.project_id);
    addField('artifact_type', data.artifact_type);
    addField('title', data.title);
    addField('content', data.content);
    addField('metadata_json', data.metadata_json);
    addField('status', data.status);

    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    params.push(id);

    await dbApi.exec(`UPDATE agent_artifacts SET ${fields.join(', ')} WHERE id = ?`, params);
  },

  async delete(id: number): Promise<void> {
    await dbApi.exec('DELETE FROM agent_artifacts WHERE id = ?', [id]);
  },
};
