import type {ArticleClaim, ArticleClaimSource} from '@/types/domain';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';
import {FileText} from 'lucide-react';

interface ClaimCardProps {
  claim: ArticleClaim & {sources: ArticleClaimSource[]};
  lang?: 'zh' | 'en';
}

const TYPE_LABEL: Record<string, {zh: string; en: string}> = {
  fact: {zh: '事实', en: 'Fact'},
  opinion: {zh: '观点', en: 'Opinion'},
  inference: {zh: '推断', en: 'Inference'},
};

const RISK_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  low: 'default',
  medium: 'secondary',
  high: 'destructive',
};

export default function ClaimCard({claim, lang = 'zh'}: ClaimCardProps) {
  const typeLabel = TYPE_LABEL[claim.claim_type] ?? {zh: claim.claim_type, en: claim.claim_type};
  const riskVariant = RISK_VARIANT[claim.risk_level] ?? 'default';
  const reviewVariant: 'default' | 'secondary' | 'destructive' =
    claim.review_status === 'verified'
      ? 'default'
      : claim.review_status === 'flagged'
        ? 'destructive'
        : 'secondary';

  return (
    <div className={cn('rounded-lg border p-4 space-y-2')}>
      <p className="text-sm leading-relaxed">{claim.claim_text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{lang === 'zh' ? typeLabel.zh : typeLabel.en}</Badge>
        <Badge variant={riskVariant}>
          {claim.risk_level === 'low'
            ? lang === 'zh'
              ? '低风险'
              : 'Low'
            : claim.risk_level === 'medium'
              ? lang === 'zh'
                ? '中风险'
                : 'Medium'
              : lang === 'zh'
                ? '高风险'
                : 'High'}
        </Badge>
        <Badge variant={reviewVariant}>
          {claim.review_status === 'verified'
            ? lang === 'zh'
              ? '已验证'
              : 'Verified'
            : claim.review_status === 'flagged'
              ? lang === 'zh'
                ? '已标记'
                : 'Flagged'
              : lang === 'zh'
                ? '待审核'
                : 'Pending'}
        </Badge>
        <span className="text-xs flex items-center gap-1 text-muted-foreground">
          <FileText className="w-3 h-3" />
          {claim.sources.length} {lang === 'zh' ? '来源' : 'sources'}
        </span>
      </div>
      {claim.sources.length > 0 && (
        <div className="space-y-1 pt-1">
          {claim.sources.slice(0, 2).map((source, idx) => (
            <div key={idx} className="text-xs text-muted-foreground truncate">
              [{source.source_type} #{source.source_id}] {source.source_quote ?? ''}
            </div>
          ))}
          {claim.sources.length > 2 && (
            <div className="text-xs text-muted-foreground">
              +{claim.sources.length - 2} {lang === 'zh' ? '更多' : 'more'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
