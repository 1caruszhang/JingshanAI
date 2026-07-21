import type {AgentTask} from '@/types/domain';

export async function retryStep(_taskId: number, _stepId: number): Promise<AgentTask> {
  throw new Error('RetryManager.retryStep not implemented');
}

export function shouldRetry(_error: unknown, _attemptCount: number): boolean {
  return false;
}
