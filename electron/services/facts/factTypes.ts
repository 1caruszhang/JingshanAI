import type {ExtractedFactCandidate} from '@/types/domain';

export const FACT_TYPES = [
  'full_name',
  'short_name',
  'detailed_address',
  'service_area',
  'industry',
  'products_services',
  'related_brands',
  'target_customers',
  'core_advantages',
  'trust_backing',
  'pain_points',
  'customer_cases',
  'contact',
  'derived_keywords',
] as const;

export type FactType = (typeof FACT_TYPES)[number];

export function isFactType(value: string): value is FactType {
  return (FACT_TYPES as readonly string[]).includes(value);
}

export const FACT_TYPE_LABELS: Record<FactType, string> = {
  full_name: '企业全称',
  short_name: '简称',
  detailed_address: '详细地址',
  service_area: '服务区域',
  industry: '行业',
  products_services: '产品与服务',
  related_brands: '相关品牌',
  target_customers: '目标客户',
  core_advantages: '核心优势',
  trust_backing: '信任背书',
  pain_points: '客户痛点',
  customer_cases: '客户案例',
  contact: '联系方式',
  derived_keywords: '衍生关键词',
};

export const HIGH_RISK_FACT_TYPES: Set<FactType> = new Set([
  'contact',
  'service_area',
  'core_advantages',
  'trust_backing',
  'customer_cases',
]);

export function getFactTypeLabel(type: string): string {
  return isFactType(type) ? FACT_TYPE_LABELS[type] : type;
}

export function isHighRiskFactType(type: string): boolean {
  return isFactType(type) && HIGH_RISK_FACT_TYPES.has(type);
}

export interface FactExtractionOutput {
  facts: ExtractedFactCandidate[];
  missing_fields: string[];
  risk_warnings: string[];
}

export interface FactExtractionResult {
  extractedCount: number;
  factIds: number[];
  warnings: string[];
  missingFields: string[];
  riskWarnings: string[];
}

export const REQUIRED_FACT_TYPES_FOR_ARTICLE: FactType[] = [
  'full_name',
  'industry',
  'products_services',
  'core_advantages',
];
