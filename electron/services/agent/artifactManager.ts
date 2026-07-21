import type {AgentArtifact} from '@/types/domain';

export async function createArtifact(
  _taskId: number,
  _type: string,
  _content: string,
): Promise<AgentArtifact> {
  throw new Error('ArtifactManager.createArtifact not implemented');
}

export async function getArtifacts(_taskId: number): Promise<AgentArtifact[]> {
  throw new Error('ArtifactManager.getArtifacts not implemented');
}
