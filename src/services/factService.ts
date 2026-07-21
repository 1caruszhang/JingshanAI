import {factApi, dbApi} from '../lib/electron-api';
import type {EnterpriseFact} from '../types/domain';

const FACT_COLUMNS = `
  id, project_id, fact_type, fact_key, fact_value, confidence,
  source_entry_id, source_chunk_id, source_quote,
  extraction_model, extraction_prompt_version, status,
  reviewed_at, reviewed_by, review_metadata_json, replaces_fact_id, extracted_json,
  created_at
`;

export const factService = {
  async getByProject(projectId: number): Promise<EnterpriseFact[]> {
    const result = await factApi.list({projectId, limit: 500});
    return result.facts;
  },

  async getById(id: number): Promise<EnterpriseFact | undefined> {
    const rows = (await dbApi.query(
      `SELECT ${FACT_COLUMNS}
       FROM enterprise_facts
       WHERE id = ?`,
      [id],
    )) as EnterpriseFact[];
    return rows[0];
  },

  async create(
    data: Omit<EnterpriseFact, 'id' | 'created_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO enterprise_facts (
         project_id, fact_type, fact_key, fact_value, confidence,
         source_entry_id, source_chunk_id, source_quote,
         extraction_model, extraction_prompt_version, status,
         reviewed_at, reviewed_by, review_metadata_json, replaces_fact_id, extracted_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        data.project_id,
        data.fact_type,
        data.fact_key,
        data.fact_value ?? null,
        data.confidence ?? 1.0,
        data.source_entry_id ?? null,
        data.source_chunk_id ?? null,
        data.source_quote ?? null,
        data.extraction_model ?? null,
        data.extraction_prompt_version ?? null,
        data.status ?? 'candidate',
        data.reviewed_at ?? null,
        data.reviewed_by ?? null,
        data.review_metadata_json ?? null,
        data.replaces_fact_id ?? null,
        data.extracted_json ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async updateStatus(id: number, status: EnterpriseFact['status']): Promise<void> {
    await dbApi.exec('UPDATE enterprise_facts SET status = ? WHERE id = ?', [status, id]);
  },

  async delete(id: number): Promise<void> {
    await dbApi.exec('DELETE FROM enterprise_facts WHERE id = ?', [id]);
  },
};
