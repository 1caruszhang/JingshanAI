import type {AssistantRun} from '@/types/domain';

export async function getRun(_id: number): Promise<AssistantRun | undefined> {
  throw new Error('AssistantRunService.getRun not implemented');
}

export async function updateRunStatus(_id: number, _status: string): Promise<void> {
  throw new Error('AssistantRunService.updateRunStatus not implemented');
}
