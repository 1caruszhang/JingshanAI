import type {ToolApproval} from '@/types/domain';

export async function requestApproval(_toolCallId: number, _approvalType: string): Promise<ToolApproval> {
  throw new Error('ApprovalManager.requestApproval not implemented');
}

export async function resolveApproval(_approvalId: number, _approved: boolean): Promise<void> {
  throw new Error('ApprovalManager.resolveApproval not implemented');
}
