import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useTheme } from '../../hooks/use-theme';
import { Activity, FileText, Globe, CheckCircle2 } from 'lucide-react';

interface ActivityItem {
  id: string;
  title: string;
  time: string;
  type: string;
}

interface RecentActivityFeedProps {
  items: ActivityItem[];
  loading?: boolean;
}

const typeConfig: Record<string, { icon: typeof Activity; color: string; bg: string }> = {
  run: { icon: Activity, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
  publish: { icon: Globe, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20' },
  draft: { icon: FileText, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20' },
  default: { icon: CheckCircle2, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-zinc-900/30' },
};

export default function RecentActivityFeed({ items, loading }: RecentActivityFeedProps) {
  const { cls, t } = useTheme();

  if (loading) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <Skeleton className="h-4 w-24 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors flex items-center justify-center min-h-[200px]', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <EmptyState title={t.recentActivityEmptyTitle ?? '暂无活动记录'} description={t.recentActivityEmptyDesc ?? '近期活动将在此显示。'} />
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <h3 className="text-sm font-bold mb-4">{t.recentActivityTitle ?? '最近活动'}</h3>
      <div className="space-y-3">
        {items.map((item) => {
          const config = typeConfig[item.type] || typeConfig.default;
          const Icon = config.icon;
          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl transition-colors',
                cls('hover:bg-gray-50', 'hover:bg-white/5')
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  config.bg
                )}
              >
                <Icon className={cn('w-4 h-4', config.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{item.title}</p>
              </div>
              <span className={cn('text-xs font-medium shrink-0', cls('text-gray-400', 'text-zinc-500'))}>
                {item.time}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
