import { dbApi } from '../lib/electron-api';
import type { VisibilityCheck } from '../types/domain';

export const visibilityService = {
  async getByProject(projectId: number): Promise<VisibilityCheck[]> {
    return dbApi.query(
      `SELECT id, project_id, artifact_id, publish_record_id, target_engine,
              check_provider, check_api_mode, check_tool_type, check_feature,
              check_method, provider_response_id, query, published_url,
              mentioned, cited, citation_urls_json, answer_text, search_summary,
              matched_snippets_json, confidence, raw_response_json,
              rank, response_text, matched, matched_url, matched_quote, checked_at
       FROM visibility_checks
       WHERE project_id = ?
       ORDER BY checked_at DESC`,
      [projectId],
    ) as Promise<VisibilityCheck[]>;
  },

  async getByPublishRecord(
    publishRecordId: number,
  ): Promise<VisibilityCheck[]> {
    return dbApi.query(
      `SELECT id, project_id, artifact_id, publish_record_id, target_engine,
              check_provider, check_api_mode, check_tool_type, check_feature,
              check_method, provider_response_id, query, published_url,
              mentioned, cited, citation_urls_json, answer_text, search_summary,
              matched_snippets_json, confidence, raw_response_json,
              rank, response_text, matched, matched_url, matched_quote, checked_at
       FROM visibility_checks
       WHERE publish_record_id = ?
       ORDER BY checked_at DESC`,
      [publishRecordId],
    ) as Promise<VisibilityCheck[]>;
  },

  async create(
    data: Omit<VisibilityCheck, 'id' | 'checked_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO visibility_checks (
         project_id, artifact_id, publish_record_id, target_engine,
         check_provider, check_api_mode, check_tool_type, check_feature,
         check_method, provider_response_id, query, published_url,
         mentioned, cited, citation_urls_json, answer_text, search_summary,
         matched_snippets_json, confidence, raw_response_json,
         rank, response_text, matched, matched_url, matched_quote, checked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        data.project_id ?? null,
        data.artifact_id ?? null,
        data.publish_record_id,
        data.target_engine ?? null,
        data.check_provider ?? null,
        data.check_api_mode ?? null,
        data.check_tool_type ?? null,
        data.check_feature ?? null,
        data.check_method ?? null,
        data.provider_response_id ?? null,
        data.query,
        data.published_url ?? null,
        data.mentioned ?? false,
        data.cited ?? false,
        data.citation_urls_json ?? null,
        data.answer_text ?? null,
        data.search_summary ?? null,
        data.matched_snippets_json ?? null,
        data.confidence ?? null,
        data.raw_response_json ?? null,
        data.rank ?? null,
        data.response_text ?? null,
        data.matched ?? false,
        data.matched_url ?? null,
        data.matched_quote ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },
};
