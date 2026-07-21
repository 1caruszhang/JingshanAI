import type {GeoAgentContext} from '@/types/domain';

export async function buildAgentContext(_projectId?: number, _taskId?: number): Promise<GeoAgentContext> {
  throw new Error('AgentContextBuilder.buildAgentContext not implemented');
}
