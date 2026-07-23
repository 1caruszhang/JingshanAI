'use client';

import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toolApprovalApi } from '@/lib/electron-api';
import { useState } from 'react';
import { ShieldAlert, CheckCircle, XCircle } from 'lucide-react';

interface ApprovalCardProps {
  approvalId: number;
  toolCallId?: number;
  title: string;
  description?: string;
  status?: 'pending' | 'approved' | 'rejected';
  onRespond?: (approved: boolean) => void;
}

export default function ApprovalCard({
  approvalId,
  title,
  description,
  status: initialStatus = 'pending',
  onRespond,
}: ApprovalCardProps) {
  const { cls } = useTheme();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>(initialStatus);
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [remark, setRemark] = useState('');

  const handleRespond = async (approved: boolean) => {
    if (status !== 'pending') return;
    setLoading(approved ? 'approve' : 'reject');
    try {
      await toolApprovalApi.respond(approvalId, approved);
      setStatus(approved ? 'approved' : 'rejected');
      onRespond?.(approved);
    } catch (err) {
      console.error('Tool approval respond failed:', err);
    } finally {
      setLoading(null);
    }
  };

  let argsDisplay: string | undefined;
  if (description) {
    try {
      const parsed = JSON.parse(description) as unknown;
      argsDisplay = JSON.stringify(parsed, null, 2);
    } catch {
      argsDisplay = description;
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-4 mt-3 flex flex-col gap-3',
        cls(
          'bg-amber-50 border-amber-200',
          'bg-amber-950/30 border-amber-800/50',
        ),
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className={cn('w-4 h-4 mt-0.5 shrink-0', cls('text-amber-600', 'text-amber-400'))} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-sm font-medium', cls('text-amber-900', 'text-amber-200'))}>
              {title}
            </span>
            {status !== 'pending' && (
              <Badge
                variant={status === 'approved' ? 'default' : 'destructive'}
                className="text-xs"
              >
                {status === 'approved' ? '已批准' : '已拒绝'}
              </Badge>
            )}
          </div>
          {argsDisplay && (
            <pre
              className={cn(
                'mt-2 text-xs rounded-lg p-2 overflow-x-auto max-h-40',
                cls('bg-amber-100/60 text-amber-800', 'bg-amber-900/30 text-amber-300'),
              )}
            >
              {argsDisplay}
            </pre>
          )}
        </div>
      </div>

      {status === 'pending' && (
        <div className="flex flex-col gap-2 pl-6">
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="备注（可选）"
            rows={2}
            className={cn(
              'w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none',
              cls(
                'bg-amber-100/40 border-amber-200 text-amber-900 placeholder:text-amber-400 focus:border-amber-400',
                'bg-amber-900/20 border-amber-800/60 text-amber-200 placeholder:text-amber-600 focus:border-amber-600',
              ),
            )}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={loading !== null}
              onClick={() => void handleRespond(true)}
              className="gap-1.5 h-7 text-xs"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {loading === 'approve' ? '批准中…' : '批准'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={loading !== null}
              onClick={() => void handleRespond(false)}
              className="gap-1.5 h-7 text-xs"
            >
              <XCircle className="w-3.5 h-3.5" />
              {loading === 'reject' ? '拒绝中…' : '拒绝'}
            </Button>
          </div>
        </div>
      )}

      {status === 'approved' && (
        <div className="pl-6 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle className="w-3.5 h-3.5" />
          操作已批准，继续执行…
        </div>
      )}

      {status === 'rejected' && (
        <div className="pl-6 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            操作已拒绝
          </div>
          {remark && (
            <p className={cn('text-xs ml-5', cls('text-amber-700', 'text-amber-400'))}>
              备注：{remark}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
