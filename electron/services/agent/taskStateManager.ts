import type {AgentTask, AgentTaskStep} from '@/types/domain';

export async function loadTask(_taskId: number): Promise<AgentTask | undefined> {
  throw new Error('TaskStateManager.loadTask not implemented');
}

export async function saveTaskStep(_taskId: number, _step: Partial<AgentTaskStep>): Promise<AgentTaskStep> {
  throw new Error('TaskStateManager.saveTaskStep not implemented');
}
