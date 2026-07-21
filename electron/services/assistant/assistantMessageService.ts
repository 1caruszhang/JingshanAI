import type {ChatMessage} from '@/types/domain';

export async function getMessages(_sessionId: number, _limit?: number): Promise<ChatMessage[]> {
  throw new Error('AssistantMessageService.getMessages not implemented');
}

export async function addMessage(
  _sessionId: number,
  _role: ChatMessage['role'],
  _content: string,
): Promise<ChatMessage> {
  throw new Error('AssistantMessageService.addMessage not implemented');
}
