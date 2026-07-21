import type {EnterpriseFact, FactStatus} from '@/types/domain';
import {
  getFactById,
  updateFactStatus,
  updateFactValue,
  deprecateFact,
  createFact,
  type CreateFactInput,
} from './factRepository.ts';
import {normalizeFactType, normalizeFactValue} from './factNormalizationService.ts';
import {FACT_EXTRACTION_PROMPT_VERSION} from './factPromptBuilder.ts';

export interface ReviewOptions {
  reviewerNote?: string;
  reviewedBy?: string;
}

function buildReviewMetadata(options: ReviewOptions, action: string): string {
  return JSON.stringify({
    action,
    reviewerNote: options.reviewerNote ?? null,
    reviewedBy: options.reviewedBy ?? 'user',
    reviewedAt: new Date().toISOString(),
  });
}

export function confirmFacts(
  factIds: number[],
  options: ReviewOptions = {},
): {confirmed: number[]; warnings: string[]} {
  const confirmed: number[] = [];
  const warnings: string[] = [];

  for (const id of factIds) {
    const fact = getFactById(id);
    if (!fact) {
      warnings.push(`事实 ${id} 不存在`);
      continue;
    }
    if (fact.status === 'confirmed') {
      warnings.push(`事实 ${id} 已经是 confirmed`);
      continue;
    }

    updateFactStatus(id, 'confirmed', {
      reviewedBy: options.reviewedBy,
      reviewMetadataJson: buildReviewMetadata(options, 'confirm'),
    });

    // 如果是替换候选，确认后把旧事实标记为 deprecated
    if (fact.replaces_fact_id !== null && fact.replaces_fact_id !== undefined) {
      deprecateFact(fact.replaces_fact_id, id);
    }

    confirmed.push(id);
  }

  return {confirmed, warnings};
}

export function rejectFacts(
  factIds: number[],
  options: ReviewOptions = {},
): {rejected: number[]; warnings: string[]} {
  const rejected: number[] = [];
  const warnings: string[] = [];

  for (const id of factIds) {
    const fact = getFactById(id);
    if (!fact) {
      warnings.push(`事实 ${id} 不存在`);
      continue;
    }

    updateFactStatus(id, 'rejected', {
      reviewedBy: options.reviewedBy,
      reviewMetadataJson: buildReviewMetadata(options, 'reject'),
    });
    rejected.push(id);
  }

  return {rejected, warnings};
}

export interface ModifyAndConfirmResult {
  fact: EnterpriseFact;
  requiresConfirmation: boolean;
}

export function modifyAndConfirm(
  factId: number,
  newFactValue: string,
  options: ReviewOptions & {newFactType?: string; reviewMessageId?: number} = {},
): ModifyAndConfirmResult {
  const fact = getFactById(factId);
  if (!fact) {
    throw new Error(`事实 ${factId} 不存在`);
  }

  const normalizedType = options.newFactType
    ? normalizeFactType(options.newFactType) ?? fact.fact_type
    : fact.fact_type;
  const normalizedValue = normalizeFactValue(newFactValue);

  // 对 candidate：直接修改并确认
  if (fact.status === 'candidate') {
    updateFactValue(factId, {
      factValue: normalizedValue,
      factType: normalizedType,
      factKey: normalizedType,
      reviewMetadataJson: buildReviewMetadata(options, 'modify_and_confirm'),
      reviewedBy: options.reviewedBy,
    });
    updateFactStatus(factId, 'confirmed', {
      reviewedBy: options.reviewedBy,
      reviewMetadataJson: buildReviewMetadata(options, 'confirm_after_modify'),
    });
    return {fact: getFactById(factId)!, requiresConfirmation: false};
  }

  // 对 confirmed：生成替换候选，返回候选供用户二次确认
  const createInput: CreateFactInput = {
    project_id: fact.project_id,
    fact_type: normalizedType,
    fact_key: normalizedType,
    fact_value: normalizedValue,
    confidence: fact.confidence,
    source_entry_id: fact.source_entry_id,
    source_chunk_id: fact.source_chunk_id,
    source_quote: fact.source_quote,
    extraction_model: fact.extraction_model,
    extraction_prompt_version: FACT_EXTRACTION_PROMPT_VERSION,
    status: 'candidate',
    replaces_fact_id: fact.id,
    extracted_json: JSON.stringify({
      original_fact_id: fact.id,
      previous_value: fact.fact_value,
      proposed_value: normalizedValue,
      reviewMessageId: options.reviewMessageId ?? null,
    }),
  };

  const replacement = createFact(createInput);
  updateFactValue(replacement.id, {
    factValue: normalizedValue,
    reviewMetadataJson: buildReviewMetadata(options, 'propose_replacement'),
    reviewedBy: options.reviewedBy,
  });

  return {fact: getFactById(replacement.id)!, requiresConfirmation: true};
}
