import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useTheme } from '../../hooks/use-theme';
import { BarChart3 } from 'lucide-react';

interface StatCardItem {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down';
}

interface StatCardsProps {
  stats: StatCardItem[];
  loading?: boolean;
}

export default function StatCards({ stats, loading }: StatCardsProps) {
  const { cls, t } = useTheme();

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors flex items-center justify-center min-h-[200px]', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <EmptyState icon={<BarChart3 className="w-8 h-8" />} title={t.statCardsEmptyTitle ?? '暂无统计数据'} description={t.statCardsEmptyDesc ?? '数据将在后续阶段提供。'} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className={cn(
            'rounded-2xl p-4 border transition-colors',
            cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5')
          )}
        >
          <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
          <p className="mt-2 text-2xl font-extrabold">{s.value}</p>
          {s.change && (
            <p
              className={cn(
                'mt-1 text-xs font-bold',
                s.trend === 'down' ? 'text-rose-500' : 'text-emerald-500'
              )}
            >
              {s.trend === 'down' ? '↓' : '↑'} {s.change}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
