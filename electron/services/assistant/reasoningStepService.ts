import type {AssistantReasoningStep} from '@/types/domain';

export async function createStep(_runId: number, _title: string): Promise<AssistantReasoningStep> {
  throw new Error('ReasoningStepService.createStep not implemented');
}

export async function updateStep(_stepId: number, _content: string, _status?: string): Promise<void> {
  throw new Error('ReasoningStepService.updateStep not implemented');
}
