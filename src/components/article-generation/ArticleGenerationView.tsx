import {useState, useMemo, KeyboardEvent} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {useTheme} from '@/hooks/use-theme';
import {useView} from '@/context/ViewContext';
import {useAppState} from '@/context/AppStateContext';
import {articleService} from '@/services/articleService';
import {cn} from '@/lib/utils';
import {Sparkles, Loader2, FileText, X, Link2} from 'lucide-react';
import TitlePickerStep from './TitlePickerStep';
import type {SourceRecommendation} from '@/types/domain';

const SUPPORT_ARTICLE_TYPES = [
  {value: 'enterprise_profile', labelZh: '企业介绍', labelEn: 'Enterprise Profile'},
  {value: 'product_service_intro', labelZh: '产品服务介绍', labelEn: 'Product/Service Intro'},
  {value: 'industry_insight', labelZh: '行业洞察', labelEn: 'Industry Insight'},
  {value: 'case_study', labelZh: '客户案例', labelEn: 'Case Study'},
  {value: 'solution_guide', labelZh: '解决方案指南', labelEn: 'Solution Guide'},
];

export default function ArticleGenerationView() {
  const {cls, t, lang} = useTheme();
  const {navigateTo, viewParams} = useView();
  const {currentProject} = useAppState();

  const [strategy, setStrategy] = useState<'support_article' | 'ranking_article'>('support_article');
  const [supportType, setSupportType] = useState('enterprise_profile');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Competitor tags state for ranking_article
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [competitorInput, setCompetitorInput] = useState('');

  // Title picker state
  const [selectedTitle, setSelectedTitle] = useState('');

  // targetQuestion: from viewParams if navigated from questionPool, else manual input
  const preselectedQuestion = viewParams.selectedQuestion as string | undefined;
  const [targetQuestion, setTargetQuestion] = useState('');
  const effectiveQuestion = preselectedQuestion ?? targetQuestion;

  // Adopted sources passed from SourceDiscoveryView — used as reference
  // material and persisted to the article's source_recommendation meta.
  const adoptedSources = (viewParams.adoptedSources as SourceRecommendation[] | undefined) ?? [];

  const defaultQuestion = useMemo(() => {
    if (currentProject) {
      return lang === 'zh'
        ? `请介绍 ${currentProject.name} 的企业背景与核心优势。`
        : `Introduce the background and core advantages of ${currentProject.name}.`;
    }
    return '';
  }, [currentProject, lang]);

  const addCompetitor = (raw: string) => {
    const name = raw.trim().replace(/,$/, '').trim();
    if (!name) return;
    if (competitors.length >= 10) return;
    if (competitors.includes(name)) return;
    setCompetitors((prev) => [...prev, name]);
  };

  const handleCompetitorKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addCompetitor(competitorInput);
      setCompetitorInput('');
    }
  };

  const handleCompetitorBlur = () => {
    if (competitorInput.trim()) {
      addCompetitor(competitorInput);
      setCompetitorInput('');
    }
  };

  const removeCompetitor = (name: string) => {
    setCompetitors((prev) => prev.filter((c) => c !== name));
  };

  const handleGenerate = async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      if (strategy === 'ranking_article') {
        await articleService.generateRanking({
          projectId: currentProject.id,
          competitors,
          targetQuestion: effectiveQuestion.trim() || defaultQuestion,
        });
      } else {
        await articleService.generate({
          projectId: currentProject.id,
          strategy: 'support_article' as const,
          supportArticleType: supportType,
          targetQuestion: effectiveQuestion.trim() || defaultQuestion,
          title: selectedTitle || undefined,
          adoptedSources: adoptedSources.length > 0 ? adoptedSources : undefined,
        });
      }
      navigateTo('drafts');
    } catch (err) {
      console.error('Article generation failed:', err);
      setError(err instanceof Error ? err.message : (t.articleGenerateFailed ?? '生成失败'));
    } finally {
      setLoading(false);
    }
  };

  if (!currentProject) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t.articleGenerationTitle ?? '文章生成'}</h1>
          <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
            {t.articleNoProject ?? '请先选择一个项目'}
          </p>
        </div>
        <Card className={cn('p-12 text-center', cls('bg-white', 'bg-[#1c1c1f]'))}>
          <FileText className={cn('w-12 h-12 mx-auto mb-4', cls('text-gray-400', 'text-zinc-500'))} />
          <p className="text-sm">{t.articleNoProjectDesc ?? '在左侧选择一个项目后开始生成文章。'}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t.articleGenerationTitle ?? '文章生成'}</h1>
        <p className={cn('text-sm mt-1', cls('text-gray-500', 'text-zinc-400'))}>
          {t.articleGenerationSubtitle ??
            '基于已确认事实与参考资料，生成 GEO 优化文章。'}
        </p>
      </div>

      <Card className={cn('p-6 space-y-6', cls('bg-white', 'bg-[#1c1c1f]'))}>
        {/* Strategy selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t.articleStrategy ?? '文章策略'}</label>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as typeof strategy)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support_article">
                  {t.articleSupportArticle ?? '支持类文章'}
                </SelectItem>
                <SelectItem value="ranking_article">
                  {t.articleRankingArticle ?? '排行榜文章'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {strategy === 'support_article' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.articleSupportType ?? '文章子类型'}</label>
              <Select value={supportType} onValueChange={setSupportType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORT_ARTICLE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {lang === 'zh' ? type.labelZh : type.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Competitors (ranking_article only) */}
        {strategy === 'ranking_article' && (
          <div className="space-y-2">
            <label className="text-sm font-medium">{t.articleCompetitors ?? '竞品企业列表'}</label>
            <Input
              value={competitorInput}
              onChange={(e) => setCompetitorInput(e.target.value)}
              onKeyDown={handleCompetitorKeyDown}
              onBlur={handleCompetitorBlur}
              placeholder={t.articleCompetitorsHint ?? '输入竞品名称，按回车或逗号分隔，最多 10 个'}
              disabled={competitors.length >= 10}
            />
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {competitors.map((c) => (
                  <Badge
                    key={c}
                    variant="secondary"
                    className="gap-1 pl-2 pr-1 py-0.5 text-xs"
                  >
                    {c}
                    <button
                      onClick={() => removeCompetitor(c)}
                      className={cn(
                        'rounded-sm p-0.5 transition-colors',
                        cls('hover:bg-gray-300/60', 'hover:bg-zinc-600/60'),
                      )}
                      aria-label={`Remove ${c}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Target question */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t.articleTargetQuestion ?? '目标问题 / 主题'}</label>
          {preselectedQuestion ? (
            <div className={cn('rounded-lg px-3 py-2.5 text-sm flex items-start justify-between gap-3', cls('bg-blue-50 border border-blue-200', 'bg-blue-500/10 border border-blue-500/20'))}>
              <span className={cn(cls('text-blue-800', 'text-blue-300'))}>{preselectedQuestion}</span>
              <button
                onClick={() => navigateTo('questionPool')}
                className={cn('text-xs shrink-0 underline underline-offset-2', cls('text-blue-600 hover:text-blue-700', 'text-blue-400 hover:text-blue-300'))}
              >
                {t.articleReselect ?? '重新选择'}
              </button>
            </div>
          ) : (
            <>
              <Input
                value={targetQuestion}
                onChange={(e) => setTargetQuestion(e.target.value)}
                placeholder={defaultQuestion}
              />
              <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                {t.articleTargetQuestionHint ??
                  '留空将使用默认问题：介绍企业背景与核心优势。'}
              </p>
            </>
          )}
        </div>

        {/* Title Picker */}
        {effectiveQuestion.trim() && (
          <div className="space-y-2">
            <label className="text-sm font-medium">{lang === 'zh' ? '标题建议' : 'Title Suggestions'}</label>
            <TitlePickerStep
              projectId={currentProject.id}
              targetQuestion={effectiveQuestion.trim() || defaultQuestion}
              onSelect={setSelectedTitle}
              selectedTitle={selectedTitle}
            />
          </div>
        )}

        {/* Adopted sources summary (from SourceDiscoveryView) */}
        {adoptedSources.length > 0 && (
          <div className={cn('rounded-lg p-3 space-y-1.5', cls('bg-gray-50 border border-gray-200', 'bg-zinc-800/50 border-zinc-700'))}>
            <div className="flex items-center gap-1.5">
              <Link2 className={cn('w-3.5 h-3.5', cls('text-gray-500', 'text-zinc-400'))} />
              <span className={cn('text-xs font-medium', cls('text-gray-600', 'text-zinc-300'))}>
                {t.articleAdoptedSources ?? '参考信源'}
                <span className={cn('ml-1', cls('text-gray-400', 'text-zinc-500'))}>· {adoptedSources.length}</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {adoptedSources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-md truncate max-w-[200px]',
                    cls('bg-white text-blue-600 border border-gray-200 hover:bg-blue-50', 'bg-zinc-900 text-blue-400 border-zinc-700 hover:bg-blue-500/10'),
                  )}
                  title={s.url}
                >
                  {s.title || s.url}
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end">
          <Button onClick={handleGenerate} disabled={loading} className="gap-2">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.articleGenerating ?? '生成中…'}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t.articleGenerate ?? '生成文章'}
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
