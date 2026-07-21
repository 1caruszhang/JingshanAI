import type {ExecutionLedgerEntry} from '@/types/domain';

export async function append(
  _taskId: number | null,
  _eventType: string,
  _payload?: unknown,
  _options?: {stepId?: number; projectId?: number; actor?: string; eventName?: string},
): Promise<ExecutionLedgerEntry> {
  throw new Error('ExecutionLedger.append not implemented');
}

export async function getTimeline(_taskId: number): Promise<ExecutionLedgerEntry[]> {
  throw new Error('ExecutionLedger.getTimeline not implemented');
}
