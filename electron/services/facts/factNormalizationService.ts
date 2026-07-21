import type {ExtractedFactCandidate} from '@/types/domain';
import {FACT_TYPES, type FactType, isFactType} from './factTypes.ts';

export interface NormalizedFactCandidate extends ExtractedFactCandidate {
  fact_key: string;
  normalized_value: string;
}

export function normalizeFactCandidates(
  candidates: ExtractedFactCandidate[],
): NormalizedFactCandidate[] {
  const normalized: NormalizedFactCandidate[] = [];

  for (const c of candidates) {
    const type = normalizeFactType(c.fact_type);
    if (!type) continue;

    normalized.push({
      ...c,
      fact_type: type,
      fact_key: type,
      normalized_value: normalizeFactValue(c.fact_value),
    });
  }

  return deduplicateCandidates(normalized);
}

export function normalizeFactType(value: string): FactType | null {
  const trimmed = value.trim().toLowerCase();
  if (isFactType(trimmed)) return trimmed;

  // 简单兜底：去掉空格、下划线变体
  const collapsed = trimmed.replace(/[\s-]+/g, '_');
  if (isFactType(collapsed)) return collapsed;

  return null;
}

export function normalizeFactValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function deduplicateCandidates(
  candidates: NormalizedFactCandidate[],
): NormalizedFactCandidate[] {
  const seen = new Map<string, NormalizedFactCandidate>();

  for (const c of candidates) {
    const key = `${c.fact_type}:${c.normalized_value.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }

  return Array.from(seen.values());
}

export function getMissingFactTypes(foundTypes: Iterable<string>): FactType[] {
  const foundSet = new Set(foundTypes);
  return FACT_TYPES.filter((t) => !foundSet.has(t));
}
