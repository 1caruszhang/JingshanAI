import { dbApi } from '../lib/electron-api';
import type { PublishRecord } from '../types/domain';

export const publishService = {
  async getByArtifact(artifactId: number): Promise<PublishRecord[]> {
    return dbApi.query(
      `SELECT id, artifact_id, project_id, platform, channel_name, channel_type,
              publish_title, external_id, published_url, status,
              estimated_price, actual_price, published_at, created_at
       FROM publish_records
       WHERE artifact_id = ?
       ORDER BY created_at DESC`,
      [artifactId],
    ) as Promise<PublishRecord[]>;
  },

  async getByProject(projectId: number): Promise<PublishRecord[]> {
    return dbApi.query(
      `SELECT id, artifact_id, project_id, platform, channel_name, channel_type,
              publish_title, external_id, published_url, status,
              estimated_price, actual_price, published_at, created_at
       FROM publish_records
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    ) as Promise<PublishRecord[]>;
  },

  async publish(artifactId: number, platform: string): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO publish_records (
         artifact_id, platform, status, created_at
       ) VALUES (?, ?, 'pending', datetime('now'))`,
      [artifactId, platform],
    );
    return Number(result.lastInsertRowid);
  },

  async updateStatus(id: number, status: PublishRecord['status']): Promise<void> {
    await dbApi.exec(
      'UPDATE publish_records SET status = ? WHERE id = ?',
      [status, id],
    );
  },
};
