import {useEffect, useMemo, useState} from 'react';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from '@/components/ui/sheet';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Textarea} from '@/components/ui/textarea';
import {useTheme} from '@/hooks/use-theme';
import {articleApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import type {AgentArtifact, ArticleArtifactMeta, ArticleClaim, ArticleClaimSource, ArticleReview} from '@/types/domain';
import ClaimCard from './ClaimCard';
import ReviewBadge from './ReviewBadge';
import {Loader2, CheckCircle2, XCircle, Edit2, Save, ShieldCheck, Sparkles} from 'lucide-react';

interface ArticleDetail {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
  claims: Array<ArticleClaim & {sources: ArticleClaimSource[]}>;
  reviews: ArticleReview[];
}

interface ArticleDetailSheetProps {
  artifactId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ArticleDetailSheet({artifactId, open, onOpenChange}: ArticleDetailSheetProps) {
  const {cls, t, lang} = useTheme();
  const [data, setData] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimReviewLoading, setClaimReviewLoading] = useState(false);
  const [geoReviewLoading, setGeoReviewLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

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
    if (artifactId && open) {
      void fetchDetail(artifactId);
    } else if (!open) {
      setData(null);
      setEditing(false);
    }
  }, [artifactId, open]);

  const statusLabel = useMemo(() => {
    const map: Record<string, string> = {
      draft: t.articleStatusDraft ?? 'Draft',
      claim_reviewed: t.articleStatusClaimReviewed ?? 'Claim Reviewed',
      geo_reviewed: t.articleStatusGeoReviewed ?? 'GEO Reviewed',
      approved: t.articleStatusApproved ?? 'Approved',
      rejected: t.articleStatusRejected ?? 'Rejected',
    };
    return data?.meta.status ? (map[data.meta.status] ?? data.meta.status) : '-';
  }, [data?.meta.status, t, lang]);

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
    setError(null);
    try {
      await articleApi.updateContent(artifactId, editContent);
      setEditing(false);
      await fetchDetail(artifactId);
    } catch (err) {
      console.error('Save content failed:', err);
      setError(err instanceof Error ? err.message : '保存失败');
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn('w-full sm:max-w-3xl overflow-y-auto', cls('bg-white', 'bg-[#18181c]'))}>
        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-lg">{data.artifact.title ?? t.articleDetail ?? 'Article Detail'}</SheetTitle>
                <Badge variant={statusVariant}>{statusLabel}</Badge>
              </div>
              <SheetDescription>
                {t.articleCreatedAt ?? 'Created At'}: {formatDate(data.artifact.created_at)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2 px-4 pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClaimReview}
                disabled={claimReviewLoading || !!claimReview}
                className="gap-1.5"
              >
                {claimReviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {t.articleClaimReview ?? 'Run Claim Review'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGeoReview}
                disabled={geoReviewLoading || !claimReview || !!geoReview}
                className="gap-1.5"
              >
                {geoReviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {t.articleGeoReview ?? 'Run GEO Review'}
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

            {error && (
              <div className="px-4 pb-2 text-sm text-red-500">{error}</div>
            )}

            <Tabs defaultValue="content" className="flex-1 flex flex-col px-4 pb-4">
              <TabsList className="self-start">
                <TabsTrigger value="content">{t.articleEditContent ?? 'Content'}</TabsTrigger>
                <TabsTrigger value="claims">
                  {t.articleClaims ?? 'Claims'} ({data.claims.length})
                </TabsTrigger>
                <TabsTrigger value="reviews">{t.articleReviews ?? 'Reviews'}</TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="mt-4 space-y-3">
                {editing ? (
                  <>
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-[320px] font-mono text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                        {t.factReviewCancel ?? 'Cancel'}
                      </Button>
                      <Button size="sm" onClick={handleSaveContent} className="gap-1.5">
                        <Save className="w-4 h-4" />
                        {t.articleSaveContent ?? 'Save Content'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={cn('rounded-lg border p-4 whitespace-pre-wrap text-sm leading-relaxed', cls('bg-white', 'bg-[#1c1c1f]'))}>
                      {data.artifact.content ?? ''}
                    </div>
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                        <Edit2 className="w-4 h-4" />
                        {t.articleEditContent ?? 'Edit Content'}
                      </Button>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="claims" className="mt-4 space-y-3">
                {data.claims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.articleClaims ?? 'Claims'}: 0</p>
                ) : (
                  data.claims.map((claim) => <ClaimCard key={claim.id} claim={claim} lang={lang} />)
                )}
              </TabsContent>

              <TabsContent value="reviews" className="mt-4 space-y-3">
                {!claimReview && !geoReview ? (
                  <p className="text-sm text-muted-foreground">
                    {lang === 'zh' ? '暂无审核记录，请先运行 Claim Review。' : 'No reviews yet. Run Claim Review first.'}
                  </p>
                ) : (
                  <>
                    {claimReview && <ReviewBadge review={claimReview} lang={lang} />}
                    {geoReview && <ReviewBadge review={geoReview} lang={lang} />}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
