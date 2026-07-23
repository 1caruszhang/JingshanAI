import {getDb} from '../../db/connection.ts';
import type {ChatMessage} from '@/types/domain';

export function getMessages(sessionId: number, limit = 50): ChatMessage[] {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
    )
    .all(sessionId, limit) as ChatMessage[];
}

export function addMessage(
  sessionId: number,
  role: ChatMessage['role'],
  content: string,
  options?: {projectId?: number | null; model?: string | null},
): ChatMessage {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, project_id, role, content, model, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(sessionId, options?.projectId ?? null, role, content, options?.model ?? null);
  return db
    .prepare('SELECT * FROM chat_messages WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ChatMessage;
}
