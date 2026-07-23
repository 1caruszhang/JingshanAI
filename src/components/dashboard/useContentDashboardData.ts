import { useEffect, useState } from 'react';
import { projectService } from '../../services/projectService';
import { knowledgeBaseService } from '../../services/knowledgeBaseService';
import { factService } from '../../services/factService';
import { draftService } from '../../services/draftService';
import { publishService } from '../../services/publishService';
import type {
  KnowledgeEntry,
  EnterpriseFact,
  AgentArtifact,
  PublishRecord,
  Project,
} from '../../types/domain';
import type { KbAsset, KbHealth, StatCardItem } from './useDashboardData';
import { buildKbHealth, buildKbAssets } from './useDashboardData';

interface ProjectKbStat {
  project: Project;
  entries: KnowledgeEntry[];
  facts: EnterpriseFact[];
}

export interface ContentDashboardData {
  stats: StatCardItem[];
  kbHealth: KbHealth;
  kbAssets: KbAsset[];
  projectStats: ProjectKbStat[];
  loading: boolean;
}

async function loadProjectKbStats(projects: Project[]): Promise<ProjectKbStat[]> {
  const results = await Promise.all(
    projects.map(async (project) => {
      const [entries, facts] = await Promise.all([
        knowledgeBaseService.getEntriesByProject(project.id).catch(() => [] as KnowledgeEntry[]),
        factService.getByProject(project.id).catch(() => [] as EnterpriseFact[]),
      ]);
      return { project, entries, facts };
    }),
  );
  return results;
}

export function useContentDashboardData(): ContentDashboardData {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatCardItem[]>([]);
  const [kbHealth, setKbHealth] = useState<KbHealth>({ health: 0, indexed: 0, pending: 0 });
  const [kbAssets, setKbAssets] = useState<KbAsset[]>([]);
  const [projectStats, setProjectStats] = useState<ProjectKbStat[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const projects = await projectService.getAll();

        // 跨项目聚合 KB + 内容生产资产
        const [projectKbStats, drafts, publishes] = await Promise.all([
          loadProjectKbStats(projects),
          draftService.getAll().catch(() => [] as AgentArtifact[]),
          publishService.getAll().catch(() => [] as PublishRecord[]),
        ]);

        if (cancelled) return;

        const allEntries: KnowledgeEntry[] = projectKbStats.flatMap((s) => s.entries);
        const allFacts: EnterpriseFact[] = projectKbStats.flatMap((s) => s.facts);
        const publishedCount = publishes.filter((p) => p.status === 'published').length;

        setStats([
          { label: '知识条目', value: String(allEntries.length), trend: 'up' as const },
          { label: '企业事实', value: String(allFacts.length), trend: 'up' as const },
          { label: '稿件', value: String(drafts.length), trend: 'up' as const },
          { label: '已发布', value: String(publishedCount), trend: publishedCount > 0 ? ('up' as const) : ('down' as const) },
        ]);

        setKbHealth(buildKbHealth(allEntries));
        setKbAssets(buildKbAssets(allEntries));
        setProjectStats(projectKbStats);
      } finally {
        setTimeout(() => {
          if (!cancelled) setLoading(false);
        }, 300);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, kbHealth, kbAssets, projectStats, loading };
}
