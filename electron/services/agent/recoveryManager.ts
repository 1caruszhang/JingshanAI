import type {AgentTask} from '@/types/domain';

export async function recoverFromError(_taskId: number, _errorId: number): Promise<AgentTask> {
  throw new Error('RecoveryManager.recoverFromError not implemented');
}
