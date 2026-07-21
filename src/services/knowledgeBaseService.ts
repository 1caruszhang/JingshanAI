import { dbApi, kbApi } from '../lib/electron-api';
import type { IndexingResult, KnowledgeEntry, KnowledgeSearchResult } from '../types/domain';

export const knowledgeBaseService = {
  async getEntriesByProject(projectId: number): Promise<KnowledgeEntry[]> {
    return dbApi.query(
      `SELECT id, project_id, title, content, source_type, source_file_path, status, created_at
       FROM knowledge_entries
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    ) as Promise<KnowledgeEntry[]>;
  },

  async ingestText(projectId: number, title: string, content: string): Promise<number> {
    const result = await kbApi.ingestText(projectId, title, content);
    return result.entryId;
  },

  async ingestFile(projectId: number, title: string, filePath: string): Promise<number> {
    const result = await kbApi.ingestFile(projectId, title, filePath);
    return result.entryId;
  },

  async indexEntry(entryId: number): Promise<IndexingResult> {
    return kbApi.indexEntry(entryId);
  },

  async search(projectId: number, query: string, limit = 5): Promise<KnowledgeSearchResult[]> {
    return kbApi.search(projectId, query, limit);
  },

  async deleteEntry(id: number): Promise<void> {
    await dbApi.exec('DELETE FROM knowledge_entries WHERE id = ?', [id]);
  },
};
