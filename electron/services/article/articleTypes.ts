export type ArticleStrategy = 'support_article' | 'ranking_article';

export type SupportArticleType =
  | 'enterprise_profile'
  | 'product_service_intro'
  | 'industry_insight'
  | 'case_study'
  | 'solution_guide';

export type ArticleStatus =
  | 'draft'
  | 'claim_reviewed'
  | 'geo_reviewed'
  | 'approved'
  | 'rejected';

export type ClaimType = 'fact' | 'opinion' | 'inference';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ClaimReviewStatus = 'pending' | 'flagged' | 'verified';

export interface MappedClaimSource {
  sourceType: 'fact' | 'chunk';
  sourceId: number;
  sourceQuote?: string;
  confidence?: number;
}

export interface ParsedClaim {
  claimText: string;
  claimType: ClaimType;
  riskLevel: RiskLevel;
  sources: MappedClaimSource[];
}

export const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: '草稿',
  claim_reviewed: 'Claim 已审核',
  geo_reviewed: 'GEO 已审核',
  approved: '已通过',
  rejected: '已拒绝',
};

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  fact: '事实',
  opinion: '观点',
  inference: '推断',
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
};
