import {useState} from 'react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {Skeleton} from '@/components/ui/skeleton';
import {useTheme} from '@/hooks/use-theme';
import {titleApi} from '@/lib/electron-api';
import {cn} from '@/lib/utils';
import {Sparkles, Loader2} from 'lucide-react';
import type {TitleCandidate} from '@/types/domain';

interface TitlePickerStepProps {
  projectId: number;
  targetQuestion: string;
  onSelect: (title: string) => void;
  selectedTitle: string;
}

export default function TitlePickerStep({
  projectId,
  targetQuestion,
  onSelect,
  selectedTitle,
}: TitlePickerStepProps) {
  const {cls, t} = useTheme();
  const [candidates, setCandidates] = useState<TitleCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await titleApi.generate(projectId, targetQuestion);
      setCandidates((items as TitleCandidate[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          onClick={handleGenerate}
          disabled={loading || !targetQuestion}
          className="gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.titlePickerGenerating ?? '生成中…'}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {t.titlePickerGenerate ?? '生成标题建议'}
            </>
          )}
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <div className="space-y-2">
          {candidates.map((c) => {
            const isSelected = selectedTitle === c.titleText;
            return (
              <Card
                key={c.titleText}
                onClick={() => onSelect(c.titleText)}
                className={cn(
                  'p-4 cursor-pointer transition-colors',
                  cls('bg-white hover:bg-gray-50', 'bg-[#1c1c1f] hover:bg-[#232326]'),
                  isSelected && cls(
                    'ring-2 ring-blue-500/60 bg-blue-50/30',
                    'ring-2 ring-blue-500/40 bg-blue-500/5',
                  ),
                )}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-snug">{c.titleText}</p>
                    {isSelected && (
                      <Badge className="shrink-0 text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
                        {t.titlePickerSelected ?? '已选中'}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={Math.round(c.score * 100)} className="flex-1 h-1.5" />
                    <span className={cn('text-xs shrink-0 tabular-nums', cls('text-gray-500', 'text-zinc-400'))}>
                      {(c.score * 100).toFixed(0)}%
                    </span>
                    {c.intent && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {c.intent}
                      </Badge>
                    )}
                  </div>
                  {!isSelected && (
                    <p className={cn('text-xs', cls('text-blue-600', 'text-blue-400'))}>
                      {t.titlePickerSelect ?? '使用此标题'}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
