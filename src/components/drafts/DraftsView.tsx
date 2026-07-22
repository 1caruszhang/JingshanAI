import {useEffect, useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {useAppState} from '@/context/AppStateContext';
import {articleApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import {FileText, Plus, Loader2, ShieldCheck, Sparkles, Eye} from 'lucide-react';
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

  // Per-row loading state: Record<artifactId, 'claim' | 'geo' | null>
  const [rowLoading, setRowLoading] = useState<Record<number, 'claim' | 'geo' | null>>({});

  const setRowAction = (id: number, action: 'claim' | 'geo' | null) => {
    setRowLoading((prev) => ({...prev, [id]: action}));
  };

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

  const handleClaimReview = async (e: React.MouseEvent, artifactId: number) => {
    e.stopPropagation();
    if (rowLoading[artifactId]) return;
    setRowAction(artifactId, 'claim');
    try {
      await articleApi.claimReview(artifactId);
      await fetchArticles();
    } catch (err) {
      console.error('Claim review failed:', err);
    } finally {
      setRowAction(artifactId, null);
    }
  };

  const handleGeoReview = async (e: React.MouseEvent, artifactId: number) => {
    e.stopPropagation();
    if (rowLoading[artifactId]) return;
    setRowAction(artifactId, 'geo');
    try {
      await articleApi.geoReview(artifactId);
      await fetchArticles();
    } catch (err) {
      console.error('GEO review failed:', err);
    } finally {
      setRowAction(artifactId, null);
    }
  };

  const handleNavigateReview = (e: React.MouseEvent, artifactId: number) => {
    e.stopPropagation();
    navigateTo('humanReview', {artifactId});
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

  const strategyLabel = (type: string) => {
    if (type === 'support') return t.draftsStrategySupport ?? '支持类';
    if (type === 'ranking') return t.draftsStrategyRanking ?? '排行榜';
    return type;
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
    <div className="p-6 max-w-6xl mx-auto">
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
        <Card className={cn(cls('bg-white', 'bg-[#1c1c1f]'))}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={cn('border-b text-xs', cls('border-gray-100 text-gray-500', 'border-zinc-800 text-zinc-400'))}>
                  <th className="text-left px-4 py-3 font-medium">{lang === 'zh' ? '标题' : 'Title'}</th>
                  <th className="text-left px-4 py-3 font-medium">{lang === 'zh' ? '策略' : 'Strategy'}</th>
                  <th className="text-left px-4 py-3 font-medium">{lang === 'zh' ? '状态' : 'Status'}</th>
                  <th className="text-left px-4 py-3 font-medium">{lang === 'zh' ? '创建时间' : 'Created At'}</th>
                  <th className="text-right px-4 py-3 font-medium">{lang === 'zh' ? '操作' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {articles.map(({artifact, meta}) => {
                  const rowBusy = rowLoading[artifact.id];
                  return (
                    <tr
                      key={artifact.id}
                      onClick={() => handleOpenArticle(artifact.id)}
                      className={cn(
                        'border-b last:border-0 cursor-pointer transition-colors',
                        cls('border-gray-50 hover:bg-gray-50', 'border-zinc-800/60 hover:bg-[#232328]'),
                      )}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium line-clamp-1">
                          {artifact.title ?? (t.articleNoArticles ?? 'Untitled')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                          {strategyLabel(meta.article_strategy_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(meta.status)}>{statusLabel(meta.status)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs', cls('text-gray-400', 'text-zinc-500'))}>
                          {formatDate(artifact.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {/* Claim Review */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleClaimReview(e, artifact.id)}
                            disabled={!!rowBusy}
                            title={t.draftsClaimReview ?? 'Claim Review'}
                            className="gap-1.5 h-7 px-2 text-xs"
                          >
                            {rowBusy === 'claim' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5" />
                            )}
                            <span className="hidden sm:inline">{t.draftsClaimReview ?? 'Claim Review'}</span>
                          </Button>

                          {/* GEO Review */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleGeoReview(e, artifact.id)}
                            disabled={!!rowBusy}
                            title={t.draftsGeoReview ?? 'GEO Review'}
                            className="gap-1.5 h-7 px-2 text-xs"
                          >
                            {rowBusy === 'geo' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            <span className="hidden sm:inline">{t.draftsGeoReview ?? 'GEO Review'}</span>
                          </Button>

                          {/* Full Review page */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleNavigateReview(e, artifact.id)}
                            disabled={!!rowBusy}
                            className="gap-1.5 h-7 px-2 text-xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{t.draftsReview ?? 'Review'}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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
