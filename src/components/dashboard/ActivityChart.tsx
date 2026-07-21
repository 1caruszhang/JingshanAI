import { useMemo } from 'react';
import Chart from 'react-apexcharts';
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';
import { useTheme } from '../../hooks/use-theme';

interface ActivityChartProps {
  data: { date: string; value: number }[];
  loading?: boolean;
}

export default function ActivityChart({ data, loading }: ActivityChartProps) {
  const { isDarkMode, cls, t } = useTheme();

  const series = useMemo(
    () => [{ name: 'GEO 运行', data: data.map((d) => d.value) }],
    [data]
  );

  const options = useMemo(
    () => ({
      chart: { toolbar: { show: false }, background: 'transparent' },
      theme: { mode: isDarkMode ? ('dark' as const) : ('light' as const) },
      colors: ['#0070F3'],
      xaxis: {
        categories: data.map((d) => d.date),
        labels: {
          style: { colors: isDarkMode ? '#a1a1aa' : '#52525b' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: isDarkMode ? '#a1a1aa' : '#52525b' },
        },
      },
      grid: { borderColor: isDarkMode ? '#27272a' : '#e4e4e7' },
      dataLabels: { enabled: false },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.1 },
      },
      stroke: { curve: 'smooth' as const, width: 3 },
    }),
    [data, isDarkMode]
  );

  return (
    <div
      className={cn(
        'rounded-2xl p-5 border transition-colors',
        cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5')
      )}
    >
      <h3 className="text-sm font-bold mb-4">{t.activityChartTitle ?? 'GEO 运行趋势'}</h3>
      {loading ? (
        <Skeleton className="h-[260px] rounded-2xl" />
      ) : (
        <Chart options={options} series={series} type="area" height={260} />
      )}
    </div>
  );
}
