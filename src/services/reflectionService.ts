import { dbApi } from '../lib/electron-api';
import type { ReflectionHypothesis, ReflectionHypothesisStatus } from '../types/domain';

export const reflectionService = {
  async getAll(): Promise<ReflectionHypothesis[]> {
    return dbApi.query(
      `SELECT id, scope, industry, channel_name, target_stage, hypothesis_type,
              content, positive_examples, negative_examples, sample_size,
              effect_score, confidence, status, last_validated_at, decay_at,
              created_at, updated_at
       FROM reflection_hypotheses
       ORDER BY created_at DESC`,
    ) as Promise<ReflectionHypothesis[]>;
  },

  async getById(id: number): Promise<ReflectionHypothesis | undefined> {
    const rows = (await dbApi.query(
      `SELECT id, scope, industry, channel_name, target_stage, hypothesis_type,
              content, positive_examples, negative_examples, sample_size,
              effect_score, confidence, status, last_validated_at, decay_at,
              created_at, updated_at
       FROM reflection_hypotheses
       WHERE id = ?`,
      [id],
    )) as ReflectionHypothesis[];
    return rows[0];
  },

  async create(
    data: Omit<ReflectionHypothesis, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO reflection_hypotheses (
         scope, industry, channel_name, target_stage, hypothesis_type,
         content, positive_examples, negative_examples, sample_size,
         effect_score, confidence, status, last_validated_at, decay_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        data.scope,
        data.industry ?? null,
        data.channel_name ?? null,
        data.target_stage,
        data.hypothesis_type,
        data.content,
        data.positive_examples,
        data.negative_examples,
        data.sample_size,
        data.effect_score,
        data.confidence,
        data.status,
        data.last_validated_at ?? null,
        data.decay_at ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async updateStatus(id: number, status: ReflectionHypothesisStatus): Promise<void> {
    await dbApi.exec(
      `UPDATE reflection_hypotheses
       SET status = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [status, id],
    );
  },
};
