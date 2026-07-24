import { cn } from '@/lib/utils';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../ui/hover-card';
import { useTheme } from '../../hooks/use-theme';
import { Database, FileText, CheckCircle2, Clock, Check, X } from 'lucide-react';
import {
  buildKbCoverageHealth,
  getCoverageColor,
  FACT_TIER_GROUPS,
} from '@/types/domain';
import type { EnterpriseFact, KbCoverageHealth } from '@/types/domain';
import { FileTypeBadge } from './FileTypeBadge';
import type { KbAsset } from './useDashboardData';

interface KbHealth {
  health: number;
  indexed: number;
  pending: number;
}

interface KbHealthPanelProps {
  health: KbHealth;
  assets: KbAsset[];
  loading?: boolean;
  /** #103: Confirmed facts for coverage-based health (optional, falls back to legacy). */
  confirmedFacts?: EnterpriseFact[];
}

/** #103: Shared coverage matrix tooltip content used by both KbHealthPanel and KbIngestPanel. */
export function CoverageMatrixTooltip({
  coverage,
  lang,
}: {
  coverage: KbCoverageHealth;
  lang?: string;
}) {
  const isZh = lang !== 'en';

  const tierColors: Record<string, { text: string; bg: string }> = {
    high_risk: {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/20',
    },
    recommended: {
      text: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/20',
    },
    basic: {
      text: 'text-gray-600 dark:text-gray-400',
      bg: 'bg-gray-50 dark:bg-gray-100/5',
    },
  };

  const tierLabels: Record<string, string> = {
    high_risk: isZh ? '高风险字段 (×2.0)' : 'High-risk (×2.0)',
    recommended: isZh ? '推荐字段 (×1.5)' : 'Recommended (×1.5)',
    basic: isZh ? '基础字段 (×1.0)' : 'Basic (×1.0)',
  };

  return (
    <div className="w-64 p-1">
      <p className="text-xs font-bold mb-2 text-foreground">
        {isZh ? '企业字段覆盖矩阵' : 'Field Coverage Matrix'}
      </p>
      {FACT_TIER_GROUPS.map((group, gi) => {
        const tierKey = group.label === '高风险字段' ? 'high_risk' : group.label === '推荐字段' ? 'recommended' : 'basic';
        const tierFields = coverage.coverageMatrix.filter((f) => f.tier === tierKey);
        const colors = tierColors[tierKey];
        return (
          <div key={gi} className="mb-2 last:mb-0">
            <p className={cn('text-[10px] font-semibold mb-1', colors.text)}>
              {tierLabels[tierKey]}
            </p>
            <div className={cn('rounded-lg p-2 space-y-0.5', colors.bg)}>
              {tierFields.map((f) => (
                <div key={f.factType} className="flex items-center justify-between text-[10px]">
                  <span className="text-foreground/80">{f.label}</span>
                  {f.covered ? (
                    <span className="flex items-center gap-0.5 text-emerald-500 font-medium">
                      <Check className="w-2.5 h-2.5" />
                      {isZh ? '已覆盖' : 'Covered'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-muted-foreground">
                      <X className="w-2.5 h-2.5" />
                      {isZh ? '未覆盖' : 'Missing'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground mt-2 text-right">
        {isZh ? '满分' : 'Max score'}: {coverage.maxScore}
      </p>
    </div>
  );
}

export default function KbHealthPanel({ health, assets, loading, confirmedFacts }: KbHealthPanelProps) {
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

  // #103: Use coverage-based health when confirmedFacts is provided
  const useCoverage = confirmedFacts !== undefined;
  const coverageHealth = useCoverage
    ? buildKbCoverageHealth(confirmedFacts, assets.length)
    : null;

  const isNA = useCoverage && coverageHealth!.coverage < 0;
  const isZero = useCoverage && coverageHealth!.coverage === 0 && assets.length > 0;

  const displayPercent = useCoverage
    ? (isNA ? undefined : coverageHealth!.coverage)
    : health.health;

  const colors = useCoverage
    ? getCoverageColor(coverageHealth!.coverage)
    : {
        text:
          health.health >= 80 ? 'text-emerald-500' : health.health >= 50 ? 'text-amber-500' : 'text-rose-500',
        bg:
          health.health >= 80
            ? 'bg-emerald-50 dark:bg-emerald-950/20'
            : health.health >= 50
              ? 'bg-amber-50 dark:bg-amber-950/20'
              : 'bg-rose-50 dark:bg-rose-950/20',
        bar: '',
      };

  const statusLabel = useCoverage
    ? (isNA
        ? (t.kbCoverageNa ?? 'N/A')
        : coverageHealth!.coverage >= 80
          ? (t.kbCoverageStatusHealthy ?? '完善')
          : coverageHealth!.coverage >= 50
            ? (t.kbCoverageStatusFair ?? '一般')
            : (t.kbCoverageStatusPoor ?? '不足'))
    : (health.health >= 80
        ? (t.kbHealthStatusHealthy ?? '健康')
        : health.health >= 50
          ? (t.kbHealthStatusFair ?? '一般')
          : (t.kbHealthStatusPoor ?? '需关注'));

  const subText = useCoverage
    ? (isNA
        ? (t.kbHealthEmptyTitle ?? '知识库为空')
        : `${coverageHealth!.confirmedFields.size}/14 ${t.kbCoverageFieldsCovered ?? '字段已覆盖'}`)
    : `${health.indexed} ${t.kbHealthIndexed ?? '已索引'} / ${health.pending} ${t.kbHealthPending ?? '待处理'}`;

  // Donut stroke dasharray for the ring
  const dashValue = useCoverage
    ? (isNA || coverageHealth!.coverage <= 0 ? 0 : coverageHealth!.coverage)
    : health.health;

  const donutContent = (
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
          className={isNA ? 'text-gray-400' : colors.text}
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={`${dashValue}, 100`}
        />
      </svg>
      <span
        className={cn(
          'absolute text-sm font-extrabold',
          isNA ? 'text-gray-400' : colors.text,
        )}
      >
        {isNA ? (t.kbCoverageNa ?? 'N/A') : displayPercent}
      </span>
    </div>
  );

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">
          {useCoverage ? (t.kbCoverageTitle ?? '企业信息完整度') : (t.kbHealthTitle ?? '知识库健康度')}
        </h3>
        <Database className={cn('w-4 h-4', cls('text-gray-400', 'text-zinc-500'))} />
      </div>

      {/* Health score */}
      <div className={cn('flex items-center gap-4 p-4 rounded-xl mb-4', colors.bg)}>
        {useCoverage && coverageHealth && !isNA ? (
          <HoverCard>
            <HoverCardTrigger asChild>
              <button type="button" className="cursor-pointer">
                {donutContent}
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" className="p-3">
              <CoverageMatrixTooltip coverage={coverageHealth} lang={lang} />
            </HoverCardContent>
          </HoverCard>
        ) : (
          donutContent
        )}
        <div>
          <p className={cn('text-sm font-bold', isNA ? 'text-gray-400' : colors.text)}>
            {statusLabel}
          </p>
          <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
            {subText}
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
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm font-bold truncate">{asset.name}</p>
                <FileTypeBadge
                  fileType={asset.fileType}
                  sourceType={asset.sourceType}
                />
              </div>
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
