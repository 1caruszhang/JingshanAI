import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { useTheme } from '../../hooks/use-theme';
import { Database, FileText, CheckCircle2, Clock } from 'lucide-react';

interface KbAsset {
  name: string;
  status: 'indexed' | 'pending';
  words: number;
}

interface KbHealth {
  health: number;
  indexed: number;
  pending: number;
}

interface KbHealthPanelProps {
  health: KbHealth;
  assets: KbAsset[];
  loading?: boolean;
}

export default function KbHealthPanel({ health, assets, loading }: KbHealthPanelProps) {
  const { cls, t, lang } = useTheme();

  if (loading) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <Skeleton className="h-4 w-32 mb-4" />
        <Skeleton className="h-16 rounded-xl mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className={cn('rounded-2xl p-5 border transition-colors flex items-center justify-center min-h-[200px]', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
        <EmptyState title={t.kbHealthEmptyTitle ?? '知识库为空'} description={t.kbHealthEmptyDesc ?? '上传文档以建立知识库索引。'} />
      </div>
    );
  }

  const healthColor =
    health.health >= 80 ? 'text-emerald-500' : health.health >= 50 ? 'text-amber-500' : 'text-rose-500';
  const healthBg =
    health.health >= 80
      ? 'bg-emerald-50 dark:bg-emerald-950/20'
      : health.health >= 50
        ? 'bg-amber-50 dark:bg-amber-950/20'
        : 'bg-rose-50 dark:bg-rose-950/20';

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">{t.kbHealthTitle ?? '知识库健康度'}</h3>
        <Database className={cn('w-4 h-4', cls('text-gray-400', 'text-zinc-500'))} />
      </div>

      {/* Health score */}
      <div className={cn('flex items-center gap-4 p-4 rounded-xl mb-4', healthBg)}>
        <div className="relative w-14 h-14 flex items-center justify-center">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
            <path
              className={cls('text-gray-200', 'text-zinc-700')}
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className={healthColor}
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${health.health}, 100`}
            />
          </svg>
          <span className={cn('absolute text-sm font-extrabold', healthColor)}>{health.health}</span>
        </div>
        <div>
          <p className={cn('text-sm font-bold', healthColor)}>
            {health.health >= 80 ? (t.kbHealthStatusHealthy ?? '健康') : health.health >= 50 ? (t.kbHealthStatusFair ?? '一般') : (t.kbHealthStatusPoor ?? '需关注')}
          </p>
          <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
            {health.indexed} {t.kbHealthIndexed ?? '已索引'} / {health.pending} {t.kbHealthPending ?? '待处理'}
          </p>
        </div>
      </div>

      {/* Asset list */}
      <div className="space-y-2">
        {assets.map((asset, index) => (
          <div
            key={`${index}-${asset.name}`}
            className={cn(
              'flex items-center gap-3 p-2.5 rounded-xl transition-colors',
              cls('hover:bg-gray-50', 'hover:bg-white/5')
            )}
          >
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                asset.status === 'indexed'
                  ? 'bg-emerald-50 dark:bg-emerald-950/20'
                  : 'bg-amber-50 dark:bg-amber-950/20'
              )}
            >
              {asset.status === 'indexed' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <Clock className="w-4 h-4 text-amber-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{asset.name}</p>
              <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
              {asset.words > 0 ? `${asset.words.toLocaleString()} ${lang === 'zh' ? '字' : 'words'}` : (lang === 'zh' ? '处理中...' : 'Processing...')}
              </p>
            </div>
            <span
              className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                asset.status === 'indexed'
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                  : 'bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400'
              )}
            >
              {asset.status === 'indexed' ? (t.kbHealthIndexed ?? '已索引') : (t.kbHealthPending ?? '待处理')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
