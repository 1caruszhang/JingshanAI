import { cn } from '@/lib/utils';
import { useTheme } from '../../hooks/use-theme';
import StatCards from './StatCards';
import ActivityChart from './ActivityChart';
import ActionItemsPanel from './ActionItemsPanel';
import RecentActivityFeed from './RecentActivityFeed';
import QuickStartCards from './QuickStartCards';
import KbHealthPanel from './KbHealthPanel';
import VisibilityPanel from './VisibilityPanel';
import HypothesisPanel from './HypothesisPanel';
import { useDashboardData } from './useDashboardData';

export default function DashboardView() {
  const { t, cls } = useTheme();
  const { stats, trend, actions, activities, kbHealth, kbAssets, visibilityChecks, hypothesisRules, loading } = useDashboardData();

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className={cn('text-3xl font-bold tracking-tight', cls('text-gray-900', 'text-white'))}>
          {t.greeting}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.dashboardSubtitle}
        </p>
      </div>

      <StatCards stats={stats} loading={loading} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <ActivityChart data={trend} loading={loading} />
        </div>
        <ActionItemsPanel items={actions} loading={loading} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <RecentActivityFeed items={activities} loading={loading} />
        <QuickStartCards />
        <KbHealthPanel health={kbHealth} assets={kbAssets} loading={loading} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <VisibilityPanel checks={visibilityChecks} loading={loading} />
        <HypothesisPanel rules={hypothesisRules} loading={loading} />
      </div>
    </div>
  );
}
