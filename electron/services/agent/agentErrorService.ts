import type {AppError} from '@/types/domain';

export async function reportError(_error: unknown, _context?: unknown): Promise<AppError> {
  throw new Error('AgentErrorService.reportError not implemented');
}

export function classifyError(_error: unknown): {recoverable: boolean; retryable: boolean; type: string} {
  return {recoverable: false, retryable: false, type: 'unknown'};
}
