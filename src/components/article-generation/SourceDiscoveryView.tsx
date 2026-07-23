import {useState, useEffect, useCallback} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {sourceService} from '@/services/sourceService';
import {cn} from '@/lib/utils';
import {Globe, Loader2, ExternalLink} from 'lucide-react';
import type {SourceDecision, SourceRecommendation} from '@/types/domain';

export default function SourceDiscoveryView() {
  const {cls, t} = useTheme();
  const {navigateTo, viewParams} = useView();

  const selectedQuestion = viewParams.selectedQuestion as string | undefined;
  const projectId = viewParams.projectId as number | undefined;

  const [sources, setSources] = useState<SourceRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Persisted decisions keyed by url, mirrored from source_decisions.
  const [decisions, setDecisions] = useState<Map<string, 'adopted' | 'skipped'>>(new Map());

  // Restore previously persisted decisions when the view mounts with a project
  // + question so adopt/skip state survives navigation away and back.
  const refreshDecisions = useCallback(async () => {
    if (!projectId || !selectedQuestion) return;
    try {
      const rows = await sourceService.listDecisions(projectId, selectedQuestion);
      setDecisions(new Map(rows.map((d) => [d.url, d.decision])));
    } catch (err) {
      console.warn('[SourceDiscoveryView] failed to load decisions:', err);
    }
  }, [projectId, selectedQuestion]);

  useEffect(() => {
    void refreshDecisions();
  }, [refreshDecisions]);

  const handleDiscover = async () => {
    if (!projectId || !selectedQuestion) return;
    setLoading(true);
    setError(null);
    try {
      const items = await sourceService.discover(projectId, selectedQuestion);
      setSources(items ?? []);
      // Decisions are keyed by url; keep any that still apply to the new list.
      await refreshDecisions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Toggles a source's decision between adopted/skipped/undecided. Optimistic
   * update with rollback on persistence failure so the UI never shows a state
   * the DB doesn't reflect.
   */
  const toggleDecision = async (source: SourceRecommendation, status: 'adopted' | 'skipped') => {
    if (!projectId || !selectedQuestion) return;
    const prevDecision = decisions.get(source.url);
    const turningOff = prevDecision === status;

    const next = new Map(decisions);
    if (turningOff) next.delete(source.url);
    else next.set(source.url, status);
    setDecisions(next);

    try {
      if (turningOff) {
        await sourceService.removeDecision(projectId, selectedQuestion, source.url);
      } else if (status === 'adopted') {
        await sourceService.adopt(projectId, selectedQuestion, source);
      } else {
        await sourceService.skip(projectId, selectedQuestion, source);
      }
    } catch (err) {
      // Rollback to the pre-toggle state.
      setDecisions(decisions);
      console.warn('[SourceDiscoveryView] failed to persist decision:', err);
    }
  };

  const toggleAdopt = (source: SourceRecommendation) => toggleDecision(source, 'adopted');
  const toggleSkip = (source: SourceRecommendation) => toggleDecision(source, 'skipped');

  // Adopted sources flow into article generation as reference material.
  const adoptedSources = sources.filter((s) => decisions.get(s.url) === 'adopted');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t.sourceDiscoveryTitle ?? '信源发现'}</h1>
        <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
          {t.sourceDiscoverySubtitle ?? '为目标问题推荐相关信源'}
        </p>
      </div>

      {/* Selected question badge */}
      {selectedQuestion && (
        <div className="mb-6">
          <p className={cn('text-xs font-medium mb-2', cls('text-gray-500', 'text-zinc-400'))}>
            {t.articleSelectedQuestion ?? '选定问题'}
          </p>
          <Badge
            variant="secondary"
            className={cn(
              'text-sm px-3 py-1.5 font-normal rounded-xl max-w-full whitespace-normal text-left',
              cls('bg-blue-50 text-blue-700 border-blue-200', 'bg-blue-500/10 text-blue-400 border-blue-500/20'),
            )}
          >
            {selectedQuestion}
          </Badge>
        </div>
      )}

      <div className="mb-6 flex items-center gap-4">
        <Button onClick={handleDiscover} disabled={loading || !projectId || !selectedQuestion} className="gap-2">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.sourceDiscoveryDiscovering ?? '发现中…'}
            </>
          ) : (
            <>
              <Globe className="w-4 h-4" />
              {t.sourceDiscoveryDiscover ?? '发现信源'}
            </>
          )}
        </Button>
        {adoptedSources.length > 0 && (
          <Badge variant="secondary" className={cn('text-xs', cls('bg-green-50 text-green-700 border-green-200', 'bg-green-500/10 text-green-400 border-green-500/20'))}>
            {t.sourceDiscoveryAdoptedCount
              ? t.sourceDiscoveryAdoptedCount.replace('{n}', String(adoptedSources.length))
              : `已采用 ${adoptedSources.length} 个信源`}
          </Badge>
        )}
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {sources.length === 0 && !loading ? (
        <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <Globe className={cn('w-12 h-12 mx-auto mb-4', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm">{t.sourceDiscoveryEmpty ?? '暂无信源'}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => {
            const decision = decisions.get(source.url);
            const isAdopted = decision === 'adopted';
            const isSkipped = decision === 'skipped';
            return (
              <Card
                key={source.url}
                className={cn(
                  'p-4 transition-colors',
                  cls('bg-white', 'bg-[#1c1c1f]'),
                  isAdopted && cls('ring-2 ring-green-500/40', 'ring-2 ring-green-500/30'),
                  isSkipped && 'opacity-50',
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-snug">{source.title}</p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={cn(
                        'inline-flex items-center gap-1 text-xs truncate max-w-full',
                        cls('text-blue-600 hover:text-blue-700', 'text-blue-400 hover:text-blue-300'),
                      )}
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{source.url}</span>
                    </a>
                    {source.relevanceReason && (
                      <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                        {source.relevanceReason}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleAdopt(source)}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-full font-medium border transition-colors',
                        isAdopted
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30'
                          : cls(
                              'border-gray-200 text-gray-600 hover:bg-green-50 hover:text-green-600 hover:border-green-300',
                              'border-zinc-700 text-zinc-400 hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/30',
                            ),
                      )}
                    >
                      {t.sourceDiscoveryAdopt ?? '采用'}
                    </button>
                    <button
                      onClick={() => toggleSkip(source)}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-full font-medium border transition-colors',
                        isSkipped
                          ? cls('bg-gray-100 text-gray-500 border-gray-300', 'bg-zinc-800 text-zinc-400 border-zinc-600')
                          : cls(
                              'border-gray-200 text-gray-500 hover:bg-gray-50',
                              'border-zinc-700 text-zinc-400 hover:bg-zinc-800',
                            ),
                      )}
                    >
                      {t.sourceDiscoverySkip ?? '跳过'}
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button
          onClick={() =>
            navigateTo('articleGeneration', {
              selectedQuestion,
              projectId,
              adoptedSources,
            })
          }
          disabled={!selectedQuestion || !projectId}
        >
          {t.sourceDiscoveryNextStep ?? '下一步：生成文章'}
        </Button>
      </div>
    </div>
  );
}
