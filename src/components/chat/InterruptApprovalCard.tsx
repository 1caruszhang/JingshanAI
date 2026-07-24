'use client';

/**
 * InterruptApprovalCard.tsx
 *
 * #79: HITL bridge — 渲染中断审批卡片，用户 approve/reject 后回传 IPC。
 *
 * 当子 agent 工具因 interruptOn 触发 LangGraph interrupt 时，
 * 主进程推送 agentTask:interrupt-pending 事件，此组件渲染工具名、
 * 参数预览和 Approve/Reject 按钮。
 */

import {useState} from 'react';
import {agentTaskApi} from '@/lib/electron-api';
import type {InterruptDecision} from '@/types/domain';
import {useTheme} from '@/hooks/use-theme';
import {ShieldAlert, CheckCircle2, XCircle, Loader2} from 'lucide-react';

type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'submitting';

export interface InterruptApprovalCardProps {
  taskId: number;
  interruptData: unknown[];
  onResolved?: () => void;
}

/**
 * 从 interrupt value 中提取可读的工具信息。
 * interrupt value 来自 LangGraph interrupt() 调用时传入的值，
 * 可能包含 toolName、args 等字段。
 */
function parseInterruptValue(value: unknown): {
  toolName: string;
  argsPreview: string;
  description: string;
} {
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    const toolName = String(v.toolName ?? v.tool_name ?? v.name ?? 'unknown');
    const argsPreview = v.args ?? v.input ?? v.parameters ?? {};
    const description = String(v.description ?? v.reason ?? '');

    return {
      toolName,
      argsPreview:
        typeof argsPreview === 'string'
          ? argsPreview
          : JSON.stringify(argsPreview, null, 2),
      description: description || `${toolName} 需要你的审批才能继续执行`,
    };
  }

  return {
    toolName: 'unknown',
    argsPreview: JSON.stringify(value),
    description: '工具执行需要你的审批',
  };
}

export default function InterruptApprovalCard({
  taskId,
  interruptData,
  onResolved,
}: InterruptApprovalCardProps) {
  const {t} = useTheme();
  const [status, setStatus] = useState<DecisionStatus>('pending');
  const [error, setError] = useState<string | null>(null);

  // 解析所有中断项
  const items = interruptData.map((value) => parseInterruptValue(value));

  const handleRespond = async (decision: 'approve' | 'reject') => {
    setStatus('submitting');
    setError(null);

    try {
      const decisions: InterruptDecision[] = items.map((item) => ({
        toolName: item.toolName,
        decision,
      }));

      await agentTaskApi.respondInterrupt(taskId, decisions);
      setStatus(decision === 'approve' ? 'approved' : 'rejected');
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
      setStatus('pending');
    }
  };

  if (status === 'approved') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm text-emerald-700 dark:text-emerald-300">
          已批准 — 任务继续执行中...
        </span>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50">
        <XCircle className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-sm text-red-700 dark:text-red-300">
          已拒绝 — 工具执行被跳过
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="font-medium text-sm text-amber-800 dark:text-amber-200">
          需要你的审批
        </span>
      </div>

      {/* Tool items */}
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="p-3 rounded-md border border-amber-200/50 bg-white/50 dark:bg-black/20 space-y-2"
          >
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded">
                {item.toolName}
              </code>
            </div>
            <p className="text-xs text-muted-foreground">{item.description}</p>
            {item.argsPreview && item.argsPreview !== '{}' && (
              <pre className="text-xs text-muted-foreground bg-black/5 dark:bg-white/5 p-2 rounded overflow-auto max-h-24">
                {item.argsPreview.length > 300
                  ? item.argsPreview.slice(0, 300) + '...'
                  : item.argsPreview}
              </pre>
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {/* Actions */}
      {status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => handleRespond('approve')}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            批准
          </button>
          <button
            onClick={() => handleRespond('reject')}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            <XCircle className="w-4 h-4" />
            拒绝
          </button>
        </div>
      )}

      {status === 'submitting' && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          提交中...
        </div>
      )}
    </div>
  );
}
