import {useEffect, useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Skeleton} from '@/components/ui/skeleton';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {useAppState} from '@/context/AppStateContext';
import {questionApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import {HelpCircle, Loader2, Check, X} from 'lucide-react';
import type {QuestionPoolItem} from '@/types/domain';

export default function QuestionPoolView() {
  const {cls, t} = useTheme();
  const {navigateTo} = useView();
  const {currentProject} = useAppState();

  const [questions, setQuestions] = useState<QuestionPoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<number | null>(null);

  useEffect(() => {
    if (!currentProject) {
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    questionApi
      .list(currentProject.id)
      .then((items) => {
        setQuestions((items as QuestionPoolItem[]) ?? []);
      })
      .catch(console.error)
      .finally(() => setInitialLoading(false));
  }, [currentProject]);

  const handleGenerate = async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      const items = await questionApi.generate(currentProject.id);
      setQuestions((items as QuestionPoolItem[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (item: QuestionPoolItem) => {
    setActioningId(item.id);
    try {
      await questionApi.select(item.id);
      setQuestions((prev) =>
        prev.map((q) => (q.id === item.id ? {...q, status: 'selected'} : q)),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (item: QuestionPoolItem) => {
    setActioningId(item.id);
    try {
      await questionApi.reject(item.id);
      setQuestions((prev) =>
        prev.map((q) => (q.id === item.id ? {...q, status: 'rejected'} : q)),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setActioningId(null);
    }
  };

  const selectedQuestion = questions.find((q) => q.status === 'selected');

  if (!currentProject) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t.questionPoolTitle ?? '目标问题池'}</h1>
          <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            {t.questionPoolSubtitle ?? '生成并选择文章的目标问题'}
          </p>
        </div>
        <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <HelpCircle className={cn('w-12 h-12 mx-auto mb-4', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm">{t.articleNoProject ?? '请先选择一个项目'}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.questionPoolTitle ?? '目标问题池'}</h1>
          <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            {t.questionPoolSubtitle ?? '生成并选择文章的目标问题'}
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={loading} className="shrink-0 gap-2">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.questionPoolGenerating ?? '生成中…'}
            </>
          ) : (
            <>
              <HelpCircle className="w-4 h-4" />
              {t.questionPoolGenerate ?? '生成问题'}
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-500 mb-4">{error}</p>
      )}

      {initialLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : questions.length === 0 ? (
        <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <HelpCircle className={cn('w-12 h-12 mx-auto mb-4', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm font-medium mb-1">{t.questionPoolEmpty ?? '暂无问题'}</p>
          <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
            {t.questionPoolEmptyDesc ?? '点击"生成问题"开始'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {questions.map((item) => (
            <Card
              key={item.id}
              className={cn(
                'p-4 flex items-start gap-4 transition-colors',
                cls('bg-white', 'bg-[#1c1c1f]'),
                item.status === 'selected' && cls('ring-2 ring-blue-500/50', 'ring-2 ring-blue-500/40'),
                item.status === 'rejected' && 'opacity-50',
              )}
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className={cn('text-sm font-medium leading-snug', item.status === 'rejected' && 'line-through')}>
                  {item.questionText}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {item.score !== undefined && (
                    <Badge variant="secondary" className="text-xs">
                      {t.factReviewConfidence ?? '置信度'}: {(item.score * 100).toFixed(0)}%
                    </Badge>
                  )}
                  {item.status === 'selected' && (
                    <Badge className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
                      {t.questionPoolSelected ?? '已选中'}
                    </Badge>
                  )}
                  {item.status === 'rejected' && (
                    <Badge variant="secondary" className="text-xs">
                      {t.questionPoolRejected ?? '已拒绝'}
                    </Badge>
                  )}
                </div>
                {item.scoreReason && (
                  <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                    {item.scoreReason}
                  </p>
                )}
              </div>

              {item.status !== 'rejected' && (
                <div className="flex items-center gap-2 shrink-0">
                  {item.status !== 'selected' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actioningId === item.id}
                      onClick={() => handleSelect(item)}
                      className="gap-1.5"
                    >
                      {actioningId === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      {t.questionPoolSelect ?? '选择'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={actioningId === item.id}
                    onClick={() => handleReject(item)}
                    className={cn('gap-1.5', cls('text-gray-500 hover:text-red-500', 'text-zinc-400 hover:text-red-400'))}
                  >
                    <X className="w-3.5 h-3.5" />
                    {t.questionPoolReject ?? '拒绝'}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {selectedQuestion && (
        <div className="mt-6 flex justify-end">
          <Button
            onClick={() =>
              navigateTo('sourceDiscovery', {
                selectedQuestion: selectedQuestion.questionText,
                projectId: currentProject.id,
              })
            }
            className="gap-2"
          >
            {t.questionPoolNextStep ?? '下一步：发现信源'}
          </Button>
        </div>
      )}
    </div>
  );
}
