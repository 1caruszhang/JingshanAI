export interface QualityScoreResult {
  score: number;
  reasons: string[];
}

const FACT_KEYWORDS = [
  '电话', '地址', '邮箱', '成立', '年', '月', '日', '服务', '产品', '案例',
  '客户', '合作', '资质', '认证', '荣誉', '奖项', '主营', '业务', '有限公司',
  '公司', '企业', '品牌', '城市', '区域',
];

const RISK_KEYWORDS = [
  '第一', '唯一', '最好', '顶级', '首选', '最强', '最大', '保证', '绝对',
  '百分之百', '100%', '国家级', '独家', '无敌',
];

function estimateTokenCount(text: string): number {
  // Rough estimation: 1 Chinese char ≈ 1 token, English word ≈ 1 token
  const chineseChars = (text.match(/[一-龥]/g) ?? []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length;
  return chineseChars + englishWords;
}

function contentHash(text: string): string {
  // Simple stable hash for deduplication; not cryptographic
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return String(Math.abs(hash));
}

export function scoreChunk(text: string, contentType: string): QualityScoreResult {
  const trimmed = text.trim();
  const reasons: string[] = [];
  let score = 0.5;

  const tokenCount = estimateTokenCount(trimmed);
  const factHits = FACT_KEYWORDS.filter((kw) => trimmed.includes(kw)).length;
  const riskHits = RISK_KEYWORDS.filter((kw) => trimmed.includes(kw)).length;
  const hasNumbers = /\d/.test(trimmed);
  const hasStructure = /[:：]/.test(trimmed) || contentType !== 'paragraph';

  // Length factor
  if (tokenCount < 20) {
    score -= 0.25;
    reasons.push('过短');
  } else if (tokenCount > 50) {
    score += 0.1;
  }

  // Fact density
  if (factHits >= 2) {
    score += 0.15;
    reasons.push('包含企业事实');
  }

  // Structure bonus
  if (hasStructure) {
    score += 0.1;
    reasons.push('结构清晰');
  }

  // Numbers / specifics
  if (hasNumbers) {
    score += 0.05;
  }

  // Risk penalty
  if (riskHits > 0) {
    score -= 0.15 * riskHits;
    reasons.push('包含风险表达');
  }

  // Type bonuses
  if (contentType === 'faq' || contentType === 'case' || contentType === 'table') {
    score += 0.1;
  }

  score = Math.max(0, Math.min(1, score));
  return {score, reasons};
}

export {contentHash, estimateTokenCount};
