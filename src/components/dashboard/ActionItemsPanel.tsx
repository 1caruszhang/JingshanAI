import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useTheme } from '../../hooks/use-theme';
import { CheckCircle2, Circle, AlertTriangle, AlertCircle } from 'lucide-react';

interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  done: boolean;
}

interface ActionItemsPanelProps {
  items: ActionItem[];
  loading?: boolean;
}

const priorityConfig = (lang: string) => ({
  high: { label: lang === 'zh' ? '高' : 'High', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/20', icon: AlertTriangle },
  medium: { label: lang === 'zh' ? '中' : 'Medium', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', icon: AlertCircle },
  low: { label: lang === 'zh' ? '低' : 'Low', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20', icon: AlertCircle },
});

export default function ActionItemsPanel({ items, loading }: ActionItemsPanelProps) {
  const { cls, t, lang } = useTheme();

  if (loading) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <Skeleton className="h-4 w-24 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors flex items-center justify-center min-h-[200px]', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <EmptyState title={t.actionEmptyTitle ?? '暂无待办事项'} description={t.actionEmptyDesc ?? '所有任务已处理完毕。'} />
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">{t.actionItemsTitle ?? '待办事项'}</h3>
        <span className={cn('text-xs font-semibold', cls('text-gray-400', 'text-zinc-500'))}>
          {items.filter((i) => !i.done).length} {t.actionItemsPending ?? '待处理'}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item) => {
          const config = priorityConfig(lang)[item.priority];
          const PriorityIcon = config.icon;
          return (
            <div
              key={item.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-xl border transition-colors',
                item.done
                  ? cls('bg-gray-50/50 border-gray-100/50', 'bg-zinc-900/30 border-white/5')
                  : cls('bg-white border-gray-100 hover:border-gray-200', 'bg-[#27272a] border-white/5 hover:border-white/10')
              )}
            >
              <div className="mt-0.5 shrink-0">
                {item.done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-bold', item.done && 'line-through opacity-50')}>
                  {item.title}
                </p>
                <p className={cn('text-xs mt-0.5', cls('text-gray-500', 'text-zinc-400'))}>
                  {item.description}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0',
                  config.bg,
                  config.color
                )}
              >
                <PriorityIcon className="w-3 h-3" />
                {config.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
