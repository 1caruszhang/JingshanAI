import { dbApi, projectApi } from '../lib/electron-api';
import type { Project } from '../types/domain';

export const projectService = {
  async getAll(): Promise<Project[]> {
    return dbApi.query(
      "SELECT id, name, description, industry, region, domain, status, created_at, updated_at FROM projects WHERE status IS NULL OR status = 'active' ORDER BY updated_at DESC",
    ) as Promise<Project[]>;
  },

  async getById(id: number): Promise<Project | undefined> {
    const rows = (await dbApi.query(
      'SELECT id, name, description, industry, region, domain, status, created_at, updated_at FROM projects WHERE id = ?',
      [id],
    )) as Project[];
    return rows[0];
  },

  async create(
    data: Omit<Project, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      "INSERT INTO projects (name, description, industry, region, domain, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [
        data.name,
        data.description ?? null,
        data.industry ?? null,
        data.region ?? null,
        data.domain ?? null,
        data.status ?? 'draft',
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async update(id: number, data: Partial<Project>): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) {
      fields.push('name = ?');
      params.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      params.push(data.description);
    }
    if (data.industry !== undefined) {
      fields.push('industry = ?');
      params.push(data.industry);
    }
    if (data.region !== undefined) {
      fields.push('region = ?');
      params.push(data.region);
    }
    if (data.domain !== undefined) {
      fields.push('domain = ?');
      params.push(data.domain ?? null);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      params.push(data.status);
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    params.push(id);
    await dbApi.exec(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
      params,
    );
  },

  async canDelete(id: number): Promise<{count: number}> {
    const count = await projectApi.artifactCount(id);
    return {count};
  },

  async delete(id: number): Promise<void> {
    await dbApi.exec('DELETE FROM projects WHERE id = ?', [id]);
  },
};
