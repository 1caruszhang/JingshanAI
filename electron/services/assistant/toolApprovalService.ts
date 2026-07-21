import type {ToolApproval} from '@/types/domain';

export async function createApproval(_toolCallId: number, _approvalType: string): Promise<ToolApproval> {
  throw new Error('ToolApprovalService.createApproval not implemented');
}

export async function respond(_approvalId: number, _approved: boolean, _note?: string): Promise<void> {
  throw new Error('ToolApprovalService.respond not implemented');
}
