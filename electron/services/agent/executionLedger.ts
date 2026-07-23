import {getDb} from '../../db/connection';
import type {ExecutionLedgerEntry} from '@/types/domain';

export async function append(
  taskId: number | null,
  eventType: string,
  payload?: unknown,
  options?: {stepId?: number; projectId?: number; actor?: string; eventName?: string},
): Promise<ExecutionLedgerEntry> {
  try {
    const db = getDb();
    const actor = options?.actor ?? 'agent';
    const payloadJson = payload !== undefined ? JSON.stringify(payload) : null;
    const result = db
      .prepare(
        `INSERT INTO execution_ledger (task_id, step_id, project_id, actor, event_type, event_name, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        taskId ?? null,
        options?.stepId ?? null,
        options?.projectId ?? null,
        actor,
        eventType,
        options?.eventName ?? null,
        payloadJson,
      );

    const row = db
      .prepare('SELECT * FROM execution_ledger WHERE id = ?')
      .get(result.lastInsertRowid) as ExecutionLedgerEntry;
    return row;
  } catch (err) {
    console.error('[executionLedger] append failed:', err);
    // Return a synthetic entry so callers can continue without throwing
    return {
      id: -1,
      task_id: taskId,
      step_id: options?.stepId ?? null,
      project_id: options?.projectId ?? null,
      actor: options?.actor ?? 'agent',
      event_type: eventType,
      event_name: options?.eventName ?? null,
      payload_json: payload !== undefined ? JSON.stringify(payload) : null,
      created_at: new Date().toISOString(),
    };
  }
}

export async function getTimeline(taskId: number): Promise<ExecutionLedgerEntry[]> {
  const db = getDb();
  return db
    .prepare('SELECT * FROM execution_ledger WHERE task_id = ? ORDER BY created_at ASC, id ASC')
    .all(taskId) as ExecutionLedgerEntry[];
}
