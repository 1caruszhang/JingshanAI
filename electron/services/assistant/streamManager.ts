import type {UnifiedStreamEvent} from '../models/types.ts';

export async function* streamRun(_requestId: string): AsyncGenerator<UnifiedStreamEvent> {
  throw new Error('StreamManager.streamRun not implemented');
}
