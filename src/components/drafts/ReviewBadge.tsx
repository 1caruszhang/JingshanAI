import type {ArticleReview} from '@/types/domain';
import {Badge} from '@/components/ui/badge';
import {CheckCircle2, XCircle, AlertCircle} from 'lucide-react';

interface ReviewBadgeProps {
  review: ArticleReview;
  lang?: 'zh' | 'en';
}

export default function ReviewBadge({review, lang = 'zh'}: ReviewBadgeProps) {
  const passed = review.passed === 1;
  const score = review.score ?? null;

  let warnings: string[] = [];
  let details: Record<string, unknown> = {};
  try {
    warnings = review.risk_warnings_json
      ? (JSON.parse(review.risk_warnings_json) as string[])
      : [];
  } catch {
    warnings = [];
  }
  try {
    details = review.review_json
      ? (JSON.parse(review.review_json) as Record<string, unknown>)
      : {};
  } catch {
    details = {};
  }

  const isClaim = review.review_type === 'claim';
  const title = isClaim
    ? lang === 'zh'
      ? 'Claim Review'
      : 'Claim Review'
    : lang === 'zh'
      ? 'GEO Review'
      : 'GEO Review';

  const suggestions = Array.isArray(details.suggestions)
    ? (details.suggestions as string[])
    : [];

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {passed ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500" />
          )}
          <span className="font-medium">{title}</span>
          <Badge variant={passed ? 'default' : 'destructive'}>
            {passed
              ? lang === 'zh'
                ? '通过'
                : 'Passed'
              : lang === 'zh'
                ? '未通过'
                : 'Failed'}
          </Badge>
        </div>
        {score !== null && (
          <span className="text-sm text-muted-foreground">
            {lang === 'zh' ? '评分' : 'Score'}: {score}
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {lang === 'zh' ? '风险提示' : 'Risk Warnings'}
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {lang === 'zh' ? '优化建议' : 'Suggestions'}
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {!passed && warnings.length === 0 && suggestions.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          {lang === 'zh' ? '审核未通过，详情见 JSON 记录' : 'Review failed, see JSON record'}
        </div>
      )}
    </div>
  );
}
