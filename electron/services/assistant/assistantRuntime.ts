import type {AssistantRun} from '@/types/domain';

export interface StartAssistantRunInput {
  sessionId?: number;
  projectId?: number;
  requestId: string;
  runType?: string;
}

export async function startRun(_input: StartAssistantRunInput): Promise<AssistantRun> {
  throw new Error('AssistantRuntime.startRun not implemented');
}

export async function cancelRun(_requestId: string): Promise<void> {
  throw new Error('AssistantRuntime.cancelRun not implemented');
}
