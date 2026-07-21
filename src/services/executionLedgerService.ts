import { dbApi } from '../lib/electron-api';
import type { ExecutionLedgerEntry } from '../types/domain';

export const executionLedgerService = {
  async getByTask(taskId: number): Promise<ExecutionLedgerEntry[]> {
    return dbApi.query(
      `SELECT id, task_id, step_id, project_id, actor, event_type, event_name,
              payload_json, created_at
       FROM execution_ledger
       WHERE task_id = ?
       ORDER BY created_at ASC`,
      [taskId],
    ) as Promise<ExecutionLedgerEntry[]>;
  },

  async getByProject(projectId: number): Promise<ExecutionLedgerEntry[]> {
    return dbApi.query(
      `SELECT id, task_id, step_id, project_id, actor, event_type, event_name,
              payload_json, created_at
       FROM execution_ledger
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId],
    ) as Promise<ExecutionLedgerEntry[]>;
  },

  async create(
    data: Omit<ExecutionLedgerEntry, 'id' | 'created_at'>,
  ): Promise<number> {
    const result = await dbApi.exec(
      `INSERT INTO execution_ledger (
         task_id, step_id, project_id, actor, event_type, event_name,
         payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        data.task_id ?? null,
        data.step_id ?? null,
        data.project_id ?? null,
        data.actor,
        data.event_type,
        data.event_name ?? null,
        data.payload_json ?? null,
      ],
    );
    return Number(result.lastInsertRowid);
  },
};
