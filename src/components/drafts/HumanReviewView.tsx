import {useEffect, useMemo, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Textarea} from '@/components/ui/textarea';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {articleApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import type {AgentArtifact, ArticleArtifactMeta, ArticleClaim, ArticleClaimSource, ArticleReview} from '@/types/domain';
import ClaimCard from './ClaimCard';
import ReviewBadge from './ReviewBadge';
import {ArrowLeft, Loader2, CheckCircle2, XCircle, Edit2, Save, ShieldCheck, Sparkles} from 'lucide-react';

interface ArticleDetail {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
  claims: Array<ArticleClaim & {sources: ArticleClaimSource[]}>;
  reviews: ArticleReview[];
}

export default function HumanReviewView() {
  const {cls, t, lang} = useTheme();
  const {navigateTo, viewParams} = useView();

  const artifactId = viewParams.artifactId as number | undefined;

  const [data, setData] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimReviewLoading, setClaimReviewLoading] = useState(false);
  const [geoReviewLoading, setGeoReviewLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await articleApi.get(id);
      setData(detail);
      setEditContent(detail.artifact.content ?? '');
    } catch (err) {
      console.error('Failed to load article detail:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (artifactId) {
      void fetchDetail(artifactId);
    }
  }, [artifactId]);

  const statusLabel = useMemo(() => {
    const map: Record<string, string> = {
      draft: t.articleStatusDraft ?? 'Draft',
      claim_reviewed: t.articleStatusClaimReviewed ?? 'Claim Reviewed',
      geo_reviewed: t.articleStatusGeoReviewed ?? 'GEO Reviewed',
      approved: t.articleStatusApproved ?? 'Approved',
      rejected: t.articleStatusRejected ?? 'Rejected',
    };
    return data?.meta.status ? (map[data.meta.status] ?? data.meta.status) : '-';
  }, [data?.meta.status, t]);

  const statusVariant: 'default' | 'secondary' | 'destructive' | 'outline' = useMemo(() => {
    switch (data?.meta.status) {
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
  }, [data?.meta.status]);

  const claimReview = data?.reviews.find((r) => r.review_type === 'claim');
  const geoReview = data?.reviews.find((r) => r.review_type === 'geo');

  const handleClaimReview = async () => {
    if (!artifactId) return;
    setClaimReviewLoading(true);
    setError(null);
    try {
      await articleApi.claimReview(artifactId);
      await fetchDetail(artifactId);
    } catch (err) {
      console.error('Claim review failed:', err);
      setError(err instanceof Error ? err.message : 'Claim Review 失败');
    } finally {
      setClaimReviewLoading(false);
    }
  };

  const handleGeoReview = async () => {
    if (!artifactId) return;
    setGeoReviewLoading(true);
    setError(null);
    try {
      await articleApi.geoReview(artifactId);
      await fetchDetail(artifactId);
    } catch (err) {
      console.error('GEO review failed:', err);
      setError(err instanceof Error ? err.message : 'GEO Review 失败');
    } finally {
      setGeoReviewLoading(false);
    }
  };

  const handleUpdateStatus = async (status: 'approved' | 'rejected') => {
    if (!artifactId) return;
    setStatusLoading(true);
    setError(null);
    try {
      await articleApi.updateStatus(artifactId, status);
      await fetchDetail(artifactId);
    } catch (err) {
      console.error('Update status failed:', err);
      setError(err instanceof Error ? err.message : '状态更新失败');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSaveContent = async () => {
    if (!artifactId) return;
    setSaveLoading(true);
    setError(null);
    try {
      await articleApi.updateContent(artifactId, editContent);
      setEditing(false);
      await fetchDetail(artifactId);
    } catch (err) {
      console.error('Save content failed:', err);
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return value;
    }
  };

  if (!artifactId) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-full gap-4">
        <p className="text-sm text-muted-foreground">
          {lang === 'zh' ? '未指定文章 ID' : 'No article ID specified'}
        </p>
        <Button variant="outline" onClick={() => navigateTo('drafts')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.humanReviewBack ?? 'Back to Drafts'}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', cls('bg-gray-50', 'bg-[#111113]'))}>
      {/* Top bar */}
      <div className={cn('flex items-center gap-3 px-6 py-3 border-b flex-shrink-0', cls('bg-white border-gray-200', 'bg-[#18181c] border-zinc-800'))}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigateTo('drafts')}
          className="gap-1.5 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.humanReviewBack ?? 'Back to Drafts'}
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h1 className="font-semibold text-base truncate">
            {data?.artifact.title ?? (t.humanReviewTitle ?? 'Article Review')}
          </h1>
          {data && <Badge variant={statusVariant}>{statusLabel}</Badge>}
        </div>
        <span className={cn('text-xs shrink-0', cls('text-gray-400', 'text-zinc-500'))}>
          {data ? formatDate(data.artifact.created_at) : ''}
        </span>
      </div>

      {/* Action bar */}
      {data && (
        <div className={cn('flex flex-wrap items-center gap-2 px-6 py-2.5 border-b flex-shrink-0', cls('bg-white border-gray-200', 'bg-[#18181c] border-zinc-800'))}>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClaimReview}
            disabled={claimReviewLoading || !!claimReview}
            className="gap-1.5"
          >
            {claimReviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {t.draftsClaimReview ?? 'Claim Review'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGeoReview}
            disabled={geoReviewLoading || !claimReview || !!geoReview}
            className="gap-1.5"
          >
            {geoReviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {t.draftsGeoReview ?? 'GEO Review'}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => handleUpdateStatus('approved')}
            disabled={statusLoading || data.meta.status === 'approved'}
            className="gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            {t.articleApprove ?? 'Approve'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleUpdateStatus('rejected')}
            disabled={statusLoading || data.meta.status === 'rejected'}
            className="gap-1.5"
          >
            <XCircle className="w-4 h-4" />
            {t.articleReject ?? 'Reject'}
          </Button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-6 py-2 text-sm text-red-500 flex-shrink-0">{error}</div>
      )}

      {/* Main content */}
      {data && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Content — 60% */}
          <div className={cn('w-[60%] flex flex-col border-r overflow-hidden', cls('border-gray-200', 'border-zinc-800'))}>
            <div className={cn('flex items-center justify-between px-6 py-3 border-b flex-shrink-0', cls('border-gray-100', 'border-zinc-800'))}>
              <span className="text-sm font-medium">{t.humanReviewContent ?? 'Content'}</span>
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                  <Edit2 className="w-3.5 h-3.5" />
                  {t.humanReviewEdit ?? 'Edit Content'}
                </Button>
              )}
              {editing && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(false);
                      setEditContent(data.artifact.content ?? '');
                    }}
                  >
                    {t.factReviewCancel ?? 'Cancel'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveContent}
                    disabled={saveLoading}
                    className="gap-1.5"
                  >
                    {saveLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {t.humanReviewSave ?? 'Save Content'}
                  </Button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {editing ? (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-full h-full font-mono text-sm resize-none"
                />
              ) : (
                <div className={cn('whitespace-pre-wrap text-sm leading-relaxed', cls('text-gray-800', 'text-zinc-200'))}>
                  {data.artifact.content ?? ''}
                </div>
              )}
            </div>
          </div>

          {/* Right: Tabs — 40% */}
          <div className="w-[40%] flex flex-col overflow-hidden">
            <Tabs defaultValue="claims" className="flex flex-col flex-1 min-h-0">
              <div className={cn('px-6 pt-3 pb-0 border-b flex-shrink-0', cls('border-gray-200', 'border-zinc-800'))}>
                <TabsList>
                  <TabsTrigger value="claims">
                    {t.humanReviewClaims ?? 'Claims'} ({data.claims.length})
                  </TabsTrigger>
                  <TabsTrigger value="reviews">
                    {t.humanReviewReviews ?? 'Reviews'}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="claims" className="flex-1 overflow-y-auto p-6 mt-0 space-y-3">
                {data.claims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {lang === 'zh' ? '暂无 Claim 记录' : 'No claims yet'}
                  </p>
                ) : (
                  data.claims.map((claim) => (
                    <ClaimCard key={claim.id} claim={claim} lang={lang} />
                  ))
                )}
              </TabsContent>

              <TabsContent value="reviews" className="flex-1 overflow-y-auto p-6 mt-0 space-y-3">
                {!claimReview && !geoReview ? (
                  <p className="text-sm text-muted-foreground">
                    {lang === 'zh'
                      ? '暂无审核记录，请先运行 Claim Review。'
                      : 'No reviews yet. Run Claim Review first.'}
                  </p>
                ) : (
                  <>
                    {claimReview && <ReviewBadge review={claimReview} lang={lang} />}
                    {geoReview && <ReviewBadge review={geoReview} lang={lang} />}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}
