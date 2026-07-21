import { dbApi, ragApi } from '../lib/electron-api';
import type { ChatMessage, ChatSession, KnowledgeSearchResult } from '../types/domain';

export interface RagAnswer {
  answer: string;
  sources: KnowledgeSearchResult[];
  model: string;
}

export const chatService = {
  async getSessions(): Promise<ChatSession[]> {
    return dbApi.query(
      'SELECT id, title, session_type, created_at FROM chat_sessions ORDER BY created_at DESC',
    ) as Promise<ChatSession[]>;
  },

  async getMessages(sessionId: number): Promise<ChatMessage[]> {
    return dbApi.query(
      `SELECT id, session_id, project_id, role, content, model, intent,
              metadata_json, render_json, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC`,
      [sessionId],
    ) as Promise<ChatMessage[]>;
  },

  async createSession(title: string): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO chat_sessions (title, session_type, created_at)
       VALUES (?, 'public', datetime('now'))`,
      [title],
    );
    return Number(result.lastInsertRowid);
  },

  async addMessage(
    data: Omit<ChatMessage, 'id' | 'created_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO chat_messages (
         session_id, project_id, role, content, model,
         intent, metadata_json, render_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        data.session_id,
        data.project_id ?? null,
        data.role,
        data.content,
        data.model ?? null,
        data.intent ?? null,
        data.metadata_json ?? null,
        data.render_json ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },

  async deleteSession(id: number): Promise<void> {
    await dbApi.exec('DELETE FROM chat_sessions WHERE id = ?', [id]);
  },

  async askQuestion(
    projectId: number,
    query: string,
    limit = 5,
  ): Promise<RagAnswer> {
    return ragApi.ask(projectId, query, limit);
  },
};
