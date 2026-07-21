import { useView } from './context/ViewContext';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import LayoutShell from './components/layout/LayoutShell';
import DashboardView from './components/dashboard/DashboardView';
import ChatInterface from './components/chat/ChatInterface';
import DraftsView from './components/drafts/DraftsView';
import AutoLearningView from './components/auto-learning/AutoLearningView';
import AiWebBuilderView from './components/ai-web-builder/AiWebBuilderView';
import ErrorBoundary from './components/ErrorBoundary';
import KbIngestPanel from './components/knowledge-base/KbIngestPanel';
import KbCreateView from './components/knowledge-base/KbCreateView';
import FactReviewView from './components/facts/FactReviewView';
import ArticleGenerationView from './components/article-generation/ArticleGenerationView';
import type { View } from './types/domain';

function KbIngestWrapper() {
  const { viewParams } = useView();
  const projectId = viewParams.projectId as number | undefined;
  if (!projectId) return <AiWebBuilderView />;
  return <KbIngestPanel projectId={projectId} />;
}

const viewComponents: Record<View, React.ComponentType> = {
  dashboard: DashboardView,
  aiAgent: ChatInterface,
  drafts: DraftsView,
  autoLearning: AutoLearningView,
  aiWebBuilder: AiWebBuilderView,
  kbIngest: KbIngestWrapper,
  kbCreate: KbCreateView,
  factReview: FactReviewView,
  articleGeneration: ArticleGenerationView,
};

// 切换视图时保持 mount，避免本地状态丢失（思考动画、创建进度等）
const KEEP_ALIVE_VIEWS: View[] = ['aiAgent', 'kbCreate'];

export default function App() {
  const { activeView } = useView();

  return (
    <LayoutShell>
      <div className="relative flex-1 min-h-0">
        {(
          Object.entries(viewComponents) as [View, React.ComponentType][]
        ).map(([view, Component]) => {
          const isActive = view === activeView;
          const keepAlive = KEEP_ALIVE_VIEWS.includes(view);
          if (!isActive && !keepAlive) return null;

          return (
            <div
              key={view}
              className={cn(
                'absolute inset-0',
                isActive
                  ? 'opacity-100 pointer-events-auto z-10 transition-opacity duration-300'
                  : 'opacity-0 pointer-events-none z-0',
              )}
            >
              <ErrorBoundary>
                <Component />
              </ErrorBoundary>
            </div>
          );
        })}
      </div>
      <Toaster />
    </LayoutShell>
  );
}
