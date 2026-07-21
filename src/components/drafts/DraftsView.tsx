import {useEffect, useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {useAppState} from '@/context/AppStateContext';
import {articleApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import {FileText, Plus, Loader2} from 'lucide-react';
import type {AgentArtifact, ArticleArtifactMeta} from '@/types/domain';
import ArticleDetailSheet from './ArticleDetailSheet';

interface ArticleItem {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
}

export default function DraftsView() {
  const {cls, t, lang} = useTheme();
  const {navigateTo} = useView();
  const {currentProject} = useAppState();

  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const fetchArticles = async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      const data = await articleApi.list(currentProject.id);
      setArticles(data);
    } catch (err) {
      console.error('Failed to load articles:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchArticles();
  }, [currentProject?.id]);

  const handleOpenArticle = (artifactId: number) => {
    setSelectedId(artifactId);
    setSheetOpen(true);
  };

  const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'approved':
        return 'default';
      case 'rejected':
        return 'destructive';
      case 'geo_reviewed':
      case 'claim_reviewed':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      draft: t.articleStatusDraft ?? 'Draft',
      claim_reviewed: t.articleStatusClaimReviewed ?? 'Claim Reviewed',
      geo_reviewed: t.articleStatusGeoReviewed ?? 'GEO Reviewed',
      approved: t.articleStatusApproved ?? 'Approved',
      rejected: t.articleStatusRejected ?? 'Rejected',
    };
    return map[status] ?? status;
  };

  const formatDate = (value: string | null) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return value;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t.drafts ?? 'Drafts'}</h1>
          <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            {lang === 'zh' ? '查看、审核与管理 Agent 生成的文章。' : 'Review and manage agent-generated articles.'}
          </p>
        </div>
        <Button onClick={() => navigateTo('articleGeneration')} className="gap-2">
          <Plus className="w-4 h-4" />
          {t.articleNewArticle ?? 'New Article'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-500">{error}</div>
      )}

      {!currentProject ? (
        <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <FileText className={cn('w-12 h-12 mx-auto mb-4', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm">{t.articleNoProject ?? 'Please select a project first'}</p>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : articles.length === 0 ? (
        <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <FileText className={cn('w-12 h-12 mx-auto mb-4', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm font-medium">{t.articleNoArticles ?? 'No articles yet'}</p>
          <p className={cn('text-xs mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            {t.articleNoArticlesDesc ?? 'Click "New Article" to generate your first GEO-optimized article.'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map(({artifact, meta}) => (
            <Card
              key={artifact.id}
              onClick={() => handleOpenArticle(artifact.id)}
              className={cn(
                'p-5 cursor-pointer transition-colors',
                cls('bg-white hover:bg-gray-50', 'bg-[#1c1c1f] hover:bg-[#232328]'),
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium line-clamp-2 flex-1">{artifact.title ?? t.articleNoArticles ?? 'Untitled'}</h3>
                <Badge variant={statusVariant(meta.status)}>{statusLabel(meta.status)}</Badge>
              </div>
              <p className={cn('text-xs mt-2 line-clamp-2', cls('text-gray-500', 'text-zinc-400'))}>
                {meta.target_question ?? ''}
              </p>
              <div className={cn('text-xs mt-4', cls('text-gray-400', 'text-zinc-500'))}>
                {formatDate(artifact.created_at)}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ArticleDetailSheet
        artifactId={selectedId}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setSelectedId(null);
            void fetchArticles();
          }
        }}
      />
    </div>
  );
}
