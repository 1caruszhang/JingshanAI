import { cn } from '@/lib/utils';
import { useTheme } from '../../hooks/use-theme';
import { useAppState } from '../../context/AppStateContext';
import StatCards from './StatCards';
import ActivityChart from './ActivityChart';
import ActionItemsPanel from './ActionItemsPanel';
import RecentActivityFeed from './RecentActivityFeed';
import VisibilityPanel from './VisibilityPanel';
import HypothesisPanel from './HypothesisPanel';
import { useDashboardData } from './useDashboardData';

export default function DashboardView() {
  const { t, cls, lang } = useTheme();
  const { currentUser } = useAppState();
  const { stats, trend, actions, activities, visibilityChecks, hypothesisRules, loading } = useDashboardData();

  const userName = currentUser?.userName?.trim();
  const greeting = userName
    ? (lang === 'zh' ? `你好，${userName}` : `Hello, ${userName}`)
    : t.greeting;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className={cn('text-3xl font-bold tracking-tight', cls('text-gray-900', 'text-white'))}>
          {greeting}
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

      <RecentActivityFeed items={activities} loading={loading} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <VisibilityPanel checks={visibilityChecks} loading={loading} />
        <HypothesisPanel rules={hypothesisRules} loading={loading} />
      </div>
    </div>
  );
}
