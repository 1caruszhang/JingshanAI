import { cn } from '@/lib/utils';
import { useTheme } from '../../hooks/use-theme';
import { useView } from '../../context/ViewContext';
import { useAppState } from '../../context/AppStateContext';
import { FileText, BookOpen, Globe, Sparkles } from 'lucide-react';
import type { View } from '../../types/domain';

interface QuickAction {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  view: View;
  params?: Record<string, unknown>;
}

export default function QuickStartCards() {
  const { cls, t } = useTheme();
  const { navigateTo } = useView();
  const { currentProject } = useAppState();

  const quickActions: QuickAction[] = [
    {
      title: t.quickStartGenerateDraft,
      description: t.quickStartGenerateDraftDesc,
      icon: FileText,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-950/20',
      view: 'drafts',
    },
    {
      title: t.quickStartUpdateKb,
      description: t.quickStartUpdateKbDesc,
      icon: BookOpen,
      color: 'text-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-950/20',
      view: currentProject ? 'kbIngest' : 'kbCreate',
      params: currentProject ? { projectId: currentProject.id } : undefined,
    },
    {
      title: t.quickStartPublish,
      description: t.quickStartPublishDesc,
      icon: Globe,
      color: 'text-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-950/20',
      view: 'aiWebBuilder',
    },
    {
      title: t.quickStartOptimize,
      description: t.quickStartOptimizeDesc,
      icon: Sparkles,
      color: 'text-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-950/20',
      view: 'aiAgent',
    },
  ];

  const handleAction = (action: QuickAction) => {
    if (action.params) {
      navigateTo(action.view, action.params);
    } else {
      navigateTo(action.view);
    }
  };

  return (
    <div className={cn('rounded-2xl p-5 border transition-colors', cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'))}>
      <h3 className="text-sm font-bold mb-4">{t.quickStartTitle ?? '快速开始'}</h3>
      <div className="space-y-3">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.title}
              onClick={() => handleAction(action)}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                cls(
                  'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm',
                  'bg-[#27272a] border-white/5 hover:border-white/10 hover:bg-[#2e2e32]'
                )
              )}
            >
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', action.bg)}>
                <Icon className={cn('w-4 h-4', action.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{action.title}</p>
                <p className={cn('text-xs mt-0.5', cls('text-gray-500', 'text-zinc-400'))}>
                  {action.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
