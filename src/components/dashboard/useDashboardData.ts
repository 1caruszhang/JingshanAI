import { useEffect, useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { projectService } from '../../services/projectService';
import { knowledgeBaseService } from '../../services/knowledgeBaseService';
import { factService } from '../../services/factService';
import { agentTaskService } from '../../services/agentTaskService';
import { publishService } from '../../services/publishService';
import { visibilityService } from '../../services/visibilityService';
import { reflectionService } from '../../services/reflectionService';
import { draftService } from '../../services/draftService';
import type {
  KnowledgeEntry,
  EnterpriseFact,
  AgentTask,
  PublishRecord,
  VisibilityCheck,
  ReflectionHypothesis,
  AgentArtifact,
} from '../../types/domain';
import type { VisibilityCheckItem } from './VisibilityPanel';
import type { HypothesisItem } from './HypothesisPanel';
import type { ActionItem, ActivityItem } from '../../types/domain';

export interface KbAsset {
  name: string;
  status: 'indexed' | 'pending';
  words: number;
}

export interface KbHealth {
  health: number;
  indexed: number;
  pending: number;
}

export interface StatCardItem {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down';
}

function countWords(text: string | null): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const cnCount = (trimmed.match(/[一-龥]/g) ?? []).length;
  const enCount = (trimmed.match(/[a-zA-Z0-9_]+/g) ?? []).length;
  return cnCount + enCount;
}

function buildKbHealth(entries: KnowledgeEntry[]): KbHealth {
  const indexed = entries.filter((e) => e.status === 'indexed').length;
  const pending = entries.filter((e) => e.status === 'pending').length;
  const total = entries.length;
  const health = total === 0 ? 0 : Math.round((indexed / total) * 100);
  return { health, indexed, pending };
}

function buildKbAssets(entries: KnowledgeEntry[]): KbAsset[] {
  return entries.slice(0, 5).map((entry) => ({
    name: entry.title,
    status: entry.status === 'indexed' ? 'indexed' : 'pending',
    words: countWords(entry.content),
  }));
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function buildTrend(tasks: AgentTask[]): { date: string; value: number }[] {
  if (tasks.length === 0) return [];
  const counts = new Map<string, number>();
  const sorted = [...tasks].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const last = sorted.slice(-8);
  for (const t of last) {
    const label = formatDateLabel(t.created_at);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([date, value]) => ({date, value}));
}

function buildActions(
  facts: EnterpriseFact[],
  drafts: AgentArtifact[],
): ActionItem[] {
  const items: ActionItem[] = [];
  const pendingFacts = facts.filter((f) => f.status === 'candidate');
  if (pendingFacts.length > 0) {
    items.push({
      id: 'pending-facts',
      title: `${pendingFacts.length} 条事实待确认`,
      description: '请审阅候选企业事实',
      priority: 'high',
      done: false,
    });
  }
  const draftArtifacts = drafts.filter((a) => a.status === 'draft');
  if (draftArtifacts.length > 0) {
    items.push({
      id: 'pending-drafts',
      title: `${draftArtifacts.length} 篇草稿待审阅`,
      description: 'Agent 生成的草稿等待人工确认',
      priority: 'medium',
      done: false,
    });
  }
  return items;
}

function buildActivities(
  tasks: AgentTask[],
  publishes: PublishRecord[],
): ActivityItem[] {
  const taskItems: ActivityItem[] = tasks.slice(0, 3).map((t) => ({
    id: `task-${t.id}`,
    title: `Agent 任务 ${t.title ?? t.user_goal.slice(0, 20)}`,
    time: formatDateLabel(t.created_at),
    type: 'run',
  }));
  const publishItems: ActivityItem[] = publishes.slice(0, 3).map((p) => ({
    id: `pub-${p.id}`,
    title: `发布到 ${p.platform}`,
    time: formatDateLabel(p.created_at),
    type: 'publish',
  }));
  return [...taskItems, ...publishItems].slice(0, 5);
}

function buildVisibilityChecks(checks: VisibilityCheck[]): VisibilityCheckItem[] {
  return checks.slice(0, 5).map((c) => {
    let status: VisibilityCheckItem['status'] = 'pending';
    if (c.mentioned || c.cited) status = 'hit';
    else if (c.checked_at) status = 'miss';
    return {
      id: String(c.id),
      query: c.query ?? '',
      platform: '豆包助手',
      rank: c.rank,
      status,
    };
  });
}

function buildHypotheses(hypotheses: ReflectionHypothesis[]): HypothesisItem[] {
  return hypotheses.slice(0, 5).map((h) => ({
    id: String(h.id),
    rule: h.content.slice(0, 60),
    scope: h.scope,
    status: h.status === 'active' ? 'active' : 'draft',
  }));
}

export function useDashboardData() {
  const { currentProject } = useAppState();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatCardItem[]>([]);
  const [trend, setTrend] = useState<{date: string; value: number}[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [kbHealth, setKbHealth] = useState<KbHealth>({health: 0, indexed: 0, pending: 0});
  const [kbAssets, setKbAssets] = useState<KbAsset[]>([]);
  const [visibilityChecks, setVisibilityChecks] = useState<VisibilityCheckItem[]>([]);
  const [hypothesisRules, setHypothesisRules] = useState<HypothesisItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const projects = await projectService.getAll();
        const projectCount = projects.length;

        let entries: KnowledgeEntry[] = [];
        let facts: EnterpriseFact[] = [];
        let tasks: AgentTask[] = [];
        let publishes: PublishRecord[] = [];
        let checks: VisibilityCheck[] = [];
        let hypotheses: ReflectionHypothesis[] = [];
        let drafts: AgentArtifact[] = [];

        if (currentProject) {
          try {
            entries = await knowledgeBaseService.getEntriesByProject(currentProject.id);
          } catch {
            entries = [];
          }
          try {
            facts = await factService.getByProject(currentProject.id);
          } catch {
            facts = [];
          }
          try {
            tasks = await agentTaskService.getByProject(currentProject.id);
          } catch {
            tasks = [];
          }
          try {
            publishes = await publishService.getByProject(currentProject.id);
          } catch {
            publishes = [];
          }
          try {
            checks = await visibilityService.getByProject(currentProject.id);
          } catch {
            checks = [];
          }
          try {
            drafts = await draftService.getByProject(currentProject.id);
          } catch {
            drafts = [];
          }
        }

        try {
          hypotheses = await reflectionService.getAll();
        } catch {
          hypotheses = [];
        }

        if (cancelled) return;

        const publishedCount = publishes.filter((p) => p.status === 'published').length;
        const hitCount = checks.filter((c) => c.mentioned || c.cited).length;
        const pendingCount = entries.filter((e) => e.status === 'pending').length;

        setStats([
          { label: '项目数', value: String(projectCount), change: projectCount > 0 ? 'live' : '0', trend: 'up' as const },
          { label: '知识库', value: String(entries.length), change: undefined, trend: 'up' as const },
          { label: '生成任务', value: String(tasks.length), change: undefined, trend: 'up' as const },
          { label: '已发布', value: String(publishedCount), change: undefined, trend: publishedCount > 0 ? 'up' : 'down' },
          { label: '可见性命中', value: String(hitCount), change: undefined, trend: hitCount > 0 ? 'up' : 'down' },
          { label: '待处理', value: String(pendingCount), change: undefined, trend: 'down' as const },
        ]);

        setTrend(buildTrend(tasks));
        setActions(buildActions(facts, drafts));
        setActivities(buildActivities(tasks, publishes));
        setKbHealth(buildKbHealth(entries));
        setKbAssets(buildKbAssets(entries));
        setVisibilityChecks(buildVisibilityChecks(checks));
        setHypothesisRules(buildHypotheses(hypotheses));
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
  }, [currentProject]);

  return {
    stats,
    trend,
    actions,
    activities,
    kbHealth,
    kbAssets,
    visibilityChecks,
    hypothesisRules,
    loading,
  };
}
