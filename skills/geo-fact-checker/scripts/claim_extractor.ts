/**
 * claim_extractor.ts
 *
 * geo-fact-checker skill 的断言提取辅助模块。
 * 提供从文本中提取并表示事实性断言（claim）的轻量工具，
 * 逻辑与 geo_skills/geo-fact-checker/scripts/claim_extractor.py 行为等价。
 *
 * 由调用方（skill / Agent）决定哪些断言优先验证、如何检索证据、
 * 以及如何应用修正；本模块只做确定性的提取与启发式分类。
 */

export type ClaimType =
  | 'numeric-statistic'
  | 'date'
  | 'ranking'
  | 'competitor-info'
  | 'quote'
  | 'general-fact';

export interface Claim {
  id: string;
  text: string;
  claimType: ClaimType;
}

const NUMERIC_PATTERN = /\b\d[\d,]*(?:\.\d+)?\b/;
const DATE_PATTERN = /\b(?:19|20)\d{2}\b/;
const RANKING_PATTERN = /\b(?:#?\d+|top\s+\d+|number\s+one|no\.\s*\d+)\b/i;

const RANKING_KEYWORDS = ['market share', 'leader', 'largest', 'leading'];
const QUOTE_KEYWORDS = ['according to', 'report', 'study', 'research'];
const COMPETITOR_KEYWORDS = ['competitor', 'alternative', 'vs ', 'versus'];
const FACTUAL_MARKER_KEYWORDS = [
  'according to',
  'report',
  'study',
  'research',
  'market share',
  'leader',
  'largest',
  'top',
];

/**
 * 启发式地将一个句子分类到某个断言类型。
 */
export function guessClaimType(sentence: string): ClaimType {
  const lowered = sentence.toLowerCase();

  if (RANKING_PATTERN.test(sentence)) {
    return 'ranking';
  }
  if (RANKING_KEYWORDS.some((word) => lowered.includes(word))) {
    return 'ranking';
  }
  if (DATE_PATTERN.test(sentence)) {
    return 'date';
  }
  if (NUMERIC_PATTERN.test(sentence)) {
    return 'numeric-statistic';
  }
  if (QUOTE_KEYWORDS.some((word) => lowered.includes(word))) {
    return 'quote';
  }
  if (COMPETITOR_KEYWORDS.some((word) => lowered.includes(word))) {
    return 'competitor-info';
  }
  return 'general-fact';
}

/**
 * 基于标点的极简分句。不覆盖所有边缘情况，但对辅助用途足够。
 */
export function splitIntoSentences(text: string): string[] {
  // 将换行等空白折叠为空格，避免句子被打碎
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return [];
  }

  // 按 . ? ! 切分，同时保留标点（捕获组使分隔符留在结果中）
  const parts = cleaned.split(/([.!?])/);
  const sentences: string[] = [];
  let buffer = '';
  for (const part of parts) {
    if (part === '.' || part === '?' || part === '!') {
      buffer += part;
      const sentence = buffer.trim();
      if (sentence) {
        sentences.push(sentence);
      }
      buffer = '';
    } else {
      buffer += part;
    }
  }
  if (buffer.trim()) {
    sentences.push(buffer.trim());
  }
  return sentences;
}

/**
 * 从文本块中提取候选断言列表。
 *
 * 策略刻意保守：只保留很可能含非琐碎事实内容的句子——
 * 含数字、日期、排名，或明确引用研究/报告的句子。
 */
export function extractCandidateClaims(text: string, minLength = 20): Claim[] {
  const sentences = splitIntoSentences(text);
  const claims: Claim[] = [];

  sentences.forEach((sentence, index) => {
    const s = sentence.trim();
    if (s.length < minLength) {
      return;
    }

    // 只保留含明确事实标记的句子
    const hasMarker =
      NUMERIC_PATTERN.test(s) ||
      DATE_PATTERN.test(s) ||
      RANKING_PATTERN.test(s) ||
      FACTUAL_MARKER_KEYWORDS.some((kw) => s.toLowerCase().includes(kw));
    if (!hasMarker) {
      return;
    }

    claims.push({
      id: `C${index + 1}`,
      text: s,
      claimType: guessClaimType(s),
    });
  });

  return claims;
}
