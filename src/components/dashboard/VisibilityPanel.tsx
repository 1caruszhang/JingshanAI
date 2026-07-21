import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useTheme } from '../../hooks/use-theme';
import { Globe, TrendingUp, AlertCircle, Clock } from 'lucide-react';

export interface VisibilityCheckItem {
  id: string;
  query: string;
  platform: string;
  rank: number | null;
  status: 'hit' | 'miss' | 'pending';
}

interface VisibilityPanelProps {
  checks: VisibilityCheckItem[];
  loading?: boolean;
}

export default function VisibilityPanel({ checks, loading }: VisibilityPanelProps) {
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

  if (checks.length === 0) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors flex items-center justify-center min-h-[200px]', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <EmptyState title={t.visibilityPanelEmptyTitle ?? '暂无可见性数据'} description={t.visibilityPanelEmptyDesc ?? '运行可见性检测后结果将在此显示。'} />
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">{t.visibilityPanelTitle ?? '可见性检查'}</h3>
        <Globe className={cn('w-4 h-4', cls('text-gray-400', 'text-zinc-500'))} />
      </div>

      <div className="space-y-2">
        {checks.map((check) => {
          const statusConfig = {
            hit: {
              icon: TrendingUp,
              color: 'text-emerald-500',
              bg: 'bg-emerald-50 dark:bg-emerald-950/20',
              label: check.rank ? `第 ${check.rank} 位` : '命中',
            },
            miss: {
              icon: AlertCircle,
              color: 'text-rose-500',
              bg: 'bg-rose-50 dark:bg-rose-950/20',
              label: '未命中',
            },
            pending: {
              icon: Clock,
              color: 'text-amber-500',
              bg: 'bg-amber-50 dark:bg-amber-950/20',
              label: '检测中',
            },
          }[check.status];
          const Icon = statusConfig.icon;
          return (
            <div
              key={check.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl transition-colors',
                cls('hover:bg-gray-50', 'hover:bg-white/5')
              )}
            >
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', statusConfig.bg)}>
                <Icon className={cn('w-4 h-4', statusConfig.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{check.query}</p>
                <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>{check.platform}</p>
              </div>
              <span className={cn('text-xs font-bold', statusConfig.color)}>{statusConfig.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
