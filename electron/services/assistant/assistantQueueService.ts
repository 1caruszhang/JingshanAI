import type {AssistantQueueItem} from '@/types/domain';

export async function listItems(_runId: number): Promise<AssistantQueueItem[]> {
  throw new Error('AssistantQueueService.listItems not implemented');
}

export async function updateItem(
  _itemId: number,
  _status: string,
  _metadata?: Record<string, unknown>,
): Promise<void> {
  throw new Error('AssistantQueueService.updateItem not implemented');
}
