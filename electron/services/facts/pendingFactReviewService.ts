import type {EnterpriseFact} from '@/types/domain';
import {
  listPendingFacts,
  listFacts,
  countFactsByStatus,
  hasConfirmedFactType,
  hasHighConfidenceCandidate,
} from './factRepository.ts';
import {REQUIRED_FACT_TYPES_FOR_ARTICLE, HIGH_RISK_FACT_TYPES, type FactType} from './factTypes.ts';

export interface PendingReviewSession {
  facts: EnterpriseFact[];
  total: number;
}

export function getPendingReviewSession(projectId: number): PendingReviewSession {
  const facts = listPendingFacts(projectId);
  return {facts, total: facts.length};
}

export interface MissingFieldsResult {
  missing: string[];
  riskWarnings: string[];
}

export function getMissingFieldsAndWarnings(projectId: number): MissingFieldsResult {
  const missing: string[] = [];

  for (const type of REQUIRED_FACT_TYPES_FOR_ARTICLE) {
    if (!hasConfirmedFactType(projectId, type)) {
      missing.push(type);
    }
  }

  const riskWarnings: string[] = [];

  if (hasHighConfidenceCandidate(projectId)) {
    riskWarnings.push('存在高置信度候选事实尚未确认，可能影响生成质量');
  }

  if (!hasConfirmedFactType(projectId, 'contact')) {
    riskWarnings.push('缺少已确认的联系方式，文章中可能无法引导转化');
  }

  if (!hasConfirmedFactType(projectId, 'service_area')) {
    riskWarnings.push('缺少已确认的服务区域，可能影响本地搜索相关性');
  }

  // 高风险类型未覆盖
  const confirmedFacts = listFacts({projectId, status: 'confirmed'}).facts;
  const confirmedTypes = new Set(confirmedFacts.map((f) => f.fact_type));
  const uncoveredHighRisk = Array.from(HIGH_RISK_FACT_TYPES).filter((t) => !confirmedTypes.has(t));
  if (uncoveredHighRisk.length > 0) {
    riskWarnings.push(`高风险类型尚未全部确认：${uncoveredHighRisk.join(', ')}`);
  }

  return {missing, riskWarnings};
}

export function getFactReviewStats(projectId: number): ReturnType<typeof countFactsByStatus> {
  return countFactsByStatus(projectId);
}
