/**
 * audit_sentiment.ts
 *
 * 品牌情感信号审计：对给定文本内容做确定性的关键词信号检测，
 * 统计正向 / 负向信号数量并计算 0-10 区间的情感得分。
 *
 * 由 geo_skills/geo-sentiment-optimizer/scripts/audit_sentiment.py 重写而来，
 * 去掉 argparse CLI 包装，改为纯导出函数，供 Electron 主进程直接 import 调用。
 * 纯函数、无 IO、无外部依赖。
 */

export interface SentimentAuditResult {
  /** 命中的正向信号数量（0-3） */
  positive: number;
  /** 命中的负向信号数量（0-3） */
  negative: number;
  /** 情感得分：5 + positive - negative（理论范围 2-8） */
  score: number;
}

export function auditSentiment(content: string): SentimentAuditResult {
  const lower = content.toLowerCase();

  const positiveCount = [
    content.includes('Clear value proposition'),
    lower.includes('customer'),
    lower.includes('result'),
  ].filter(Boolean).length;

  const negativeCount = [
    lower.includes('leverage'),
    lower.includes('delve'),
    lower.includes('best') && lower.includes('tool'),
  ].filter(Boolean).length;

  return {
    positive: positiveCount,
    negative: negativeCount,
    score: 5 + positiveCount - negativeCount,
  };
}
