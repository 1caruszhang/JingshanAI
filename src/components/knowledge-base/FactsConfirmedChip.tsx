/**
 * #106: Lightweight "confirmed / total facts" chip shown in the project header.
 *
 * Extracted from KbIngestPanel so the header JSX stays readable. The chip is
 * purely presentational — it takes the confirmed and total counts and renders
 * a single inline badge. Color follows the confirmed-ratio (not field
 * coverage) so the chip's own metric drives its appearance: 100% confirmed is
 * green, partial is amber, none is rose, and an empty project is neutral gray.
 */

import { CheckCircle2 } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

export interface FactsConfirmedChipProps {
  /** Number of confirmed facts (status === 'confirmed'). */
  confirmed: number;
  /** Total number of facts (all statuses). */
  total: number;
}

export default function FactsConfirmedChip({ confirmed, total }: FactsConfirmedChipProps) {
  const { cls, t } = useTheme();

  // Ratio of confirmed to total — the chip's own metric, NOT field coverage.
  const ratio = total > 0 ? confirmed / total : -1;
  const accentCls =
    ratio < 0
      ? cls('text-gray-500', 'text-zinc-400')
      : ratio >= 1
        ? 'text-emerald-500'
        : ratio >= 0.5
          ? 'text-amber-500'
          : 'text-rose-500';
  const borderCls = cls('border-gray-200 bg-gray-50/60', 'border-zinc-700 bg-zinc-800/40');

  // Tooltip via the centralized i18n key with {confirmed}/{total} placeholders.
  const title = (t.kbConfirmedFactTitle ?? '{confirmed} / {total}')
    .replace('{confirmed}', String(confirmed))
    .replace('{total}', String(total));

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border',
        borderCls,
      )}
      title={title}
    >
      <CheckCircle2 className={cn('w-3.5 h-3.5', accentCls)} />
      <span className={cn('font-bold tabular-nums', accentCls)}>{confirmed}</span>
      <span className={cls('text-gray-400', 'text-zinc-500')}>{t.kbConfirmedFactLabel}</span>
      <span className={cn('tabular-nums', cls('text-gray-600', 'text-zinc-300'))}>{total}</span>
      <span className={cls('text-gray-400', 'text-zinc-500')}>{t.kbFactCountSuffix}</span>
    </div>
  );
}
