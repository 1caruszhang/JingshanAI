import { cn } from '@/lib/utils';
import { useTheme } from '../../hooks/use-theme';
import { useView } from '../../context/ViewContext';
import { useAppState } from '../../context/AppStateContext';
import StatCards from './StatCards';
import KbHealthPanel from './KbHealthPanel';
import { useContentDashboardData } from './useContentDashboardData';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, ChevronRight } from 'lucide-react';
import { buildKbCoverageHealth, getCoverageColor } from '@/types/domain';

export default function ContentDashboardView() {
  const { t, cls } = useTheme();
  const { navigateTo } = useView();
  const { setCurrentProject } = useAppState();
  const { stats, kbHealth, kbAssets, confirmedFacts, projectStats, loading } = useContentDashboardData();

  const handleOpenProject = (projectId: number) => {
    const project = projectStats.find((s) => s.project.id === projectId)?.project;
    if (project) setCurrentProject(project);
    navigateTo('kbIngest', { projectId });
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className={cn('text-3xl font-bold tracking-tight', cls('text-gray-900', 'text-white'))}>
          {t.contentDashboardTitle ?? '内容资产看板'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.contentDashboardSubtitle ?? '跨项目聚合知识库与内容生产资产，掌握全局健康度。'}
        </p>
      </div>

      <StatCards stats={stats} loading={loading} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* #103: Pass confirmedFacts for coverage-based health */}
        <KbHealthPanel health={kbHealth} assets={kbAssets} loading={loading} confirmedFacts={confirmedFacts} />

        {/* Per-project KB breakdown — #103: coverage-based */}
        <Card className={cn('p-5', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            {t.contentDashboardProjectList ?? '项目知识库'}
          </h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : projectStats.length === 0 ? (
            <p className={cn('text-sm py-8 text-center', cls('text-gray-500', 'text-zinc-400'))}>
              {t.noProjectsDesc}
            </p>
          ) : (
            <div className="space-y-2">
              {projectStats.map(({ project, entries, facts }) => {
                const confirmed = facts.filter((f) => f.status === 'confirmed');
                const ch = buildKbCoverageHealth(confirmed, entries.length);
                const isNA = ch.coverage < 0;
                const health = ch.coverage;
                const colors = getCoverageColor(health);
                return (
                  <button
                    key={project.id}
                    onClick={() => handleOpenProject(project.id)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left',
                      cls(
                        'bg-gray-50 border-gray-100 hover:border-gray-200 hover:shadow-sm',
                        'bg-[#27272a] border-white/5 hover:border-white/10 hover:bg-[#2e2e32]'
                      )
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{project.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {entries.length} {t.contentDashboardEntry ?? '条目'}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {facts.length} {t.contentDashboardFact ?? '事实'}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {ch.confirmedFields.size}/14 {t.contentDashboardPending ?? '已覆盖'}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('text-sm font-extrabold', isNA ? 'text-gray-400' : colors.text)}>
                        {isNA ? (t.kbCoverageNa ?? 'N/A') : health}
                      </span>
                      <ChevronRight className={cn('w-4 h-4', cls('text-gray-400', 'text-zinc-500'))} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
