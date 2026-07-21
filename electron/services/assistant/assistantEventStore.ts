import type {AssistantStreamEventRecord} from '@/types/domain';

export async function storeEvent(_runId: number, _eventType: string, _eventJson: unknown): Promise<AssistantStreamEventRecord> {
  throw new Error('AssistantEventStore.storeEvent not implemented');
}

export async function getEvents(_runId: number): Promise<AssistantStreamEventRecord[]> {
  throw new Error('AssistantEventStore.getEvents not implemented');
}
