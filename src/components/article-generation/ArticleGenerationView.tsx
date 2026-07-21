import {useState, useMemo} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
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
import {articleApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import {Sparkles, Loader2, FileText} from 'lucide-react';

const SUPPORT_ARTICLE_TYPES = [
  {value: 'enterprise_profile', labelZh: '企业介绍', labelEn: 'Enterprise Profile'},
  {value: 'product_service_intro', labelZh: '产品服务介绍', labelEn: 'Product/Service Intro'},
  {value: 'industry_insight', labelZh: '行业洞察', labelEn: 'Industry Insight'},
  {value: 'case_study', labelZh: '客户案例', labelEn: 'Case Study'},
  {value: 'solution_guide', labelZh: '解决方案指南', labelEn: 'Solution Guide'},
];

export default function ArticleGenerationView() {
  const {cls, t, lang} = useTheme();
  const {navigateTo} = useView();
  const {currentProject} = useAppState();

  const [supportType, setSupportType] = useState('enterprise_profile');
  const [targetQuestion, setTargetQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultQuestion = useMemo(() => {
    if (currentProject) {
      return lang === 'zh'
        ? `请介绍 ${currentProject.name} 的企业背景与核心优势。`
        : `Introduce the background and core advantages of ${currentProject.name}.`;
    }
    return '';
  }, [currentProject, lang]);

  const handleGenerate = async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      await articleApi.generate({
        projectId: currentProject.id,
        strategy: 'support_article' as const,
        supportArticleType: supportType,
        targetQuestion: targetQuestion.trim() || defaultQuestion,
      });
      navigateTo('drafts');
    } catch (err) {
      console.error('Article generation failed:', err);
      setError(err instanceof Error ? err.message : '生成失败');
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t.articleStrategy ?? '文章策略'}</label>
            <Select value="support_article" disabled>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.articleSupportArticle ?? '支持类文章'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support_article">
                  {t.articleSupportArticle ?? '支持类文章'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

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
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t.articleTargetQuestion ?? '目标问题 / 主题'}</label>
          <Input
            value={targetQuestion}
            onChange={(e) => setTargetQuestion(e.target.value)}
            placeholder={defaultQuestion}
          />
          <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
            {t.articleTargetQuestionHint ??
              '留空将使用默认问题：介绍企业背景与核心优势。'}
          </p>
        </div>

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
