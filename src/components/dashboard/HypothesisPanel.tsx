import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useTheme } from '../../hooks/use-theme';
import { Lightbulb, CheckCircle2, FileEdit } from 'lucide-react';

export interface HypothesisItem {
  id: string;
  rule: string;
  scope: string;
  status: 'active' | 'draft';
}

interface HypothesisPanelProps {
  rules: HypothesisItem[];
  loading?: boolean;
}

export default function HypothesisPanel({ rules, loading }: HypothesisPanelProps) {
  const { cls, t } = useTheme();

  if (loading) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors flex items-center justify-center min-h-[200px]', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <EmptyState title={t.hypothesisPanelEmptyTitle ?? '暂无优化假设'} description={t.hypothesisPanelEmptyDesc ?? '运行 AI 优化建议后将生成假设规则。'} />
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">{t.hypothesisPanelTitle ?? '优化假设'}</h3>
        <Lightbulb className={cn('w-4 h-4', cls('text-gray-400', 'text-zinc-500'))} />
      </div>

      <div className="space-y-2">
        {rules.map((rule) => {
          const isActive = rule.status === 'active';
          return (
            <div
              key={rule.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl transition-colors',
                cls('hover:bg-gray-50', 'hover:bg-white/5')
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  isActive ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-amber-50 dark:bg-amber-950/20'
                )}
              >
                {isActive ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <FileEdit className="w-4 h-4 text-amber-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{rule.rule}</p>
                <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>{rule.scope}</p>
              </div>
              <span
                className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                  isActive
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                    : 'bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400'
                )}
              >
                {isActive ? '已启用' : '草稿'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
