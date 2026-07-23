import {getDb} from '../../db/connection.ts';
import type {AssistantRun} from '@/types/domain';

export function getRun(id: number): AssistantRun | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM assistant_runs WHERE id = ?').get(id) as AssistantRun | undefined;
}

export function updateRunStatus(id: number, status: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE assistant_runs SET status = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, id);
}

export function createRun(params: {
  sessionId?: number | null;
  projectId?: number | null;
  requestId: string;
  runType?: string;
}): AssistantRun {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO assistant_runs (
         session_id, project_id, request_id, run_type, status,
         started_at, updated_at
       ) VALUES (?, ?, ?, ?, 'running', datetime('now'), datetime('now'))`,
    )
    .run(
      params.sessionId ?? null,
      params.projectId ?? null,
      params.requestId,
      params.runType ?? 'chat',
    );
  return db
    .prepare('SELECT * FROM assistant_runs WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as AssistantRun;
}
