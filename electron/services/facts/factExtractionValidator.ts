import {z} from 'zod';
import type {ExtractedFactCandidate} from '@/types/domain';
import {isFactType} from './factTypes.ts';

const ExtractedFactSchema = z.object({
  fact_type: z.string(),
  fact_value: z.string().min(1),
  source_chunk_id: z.number().int(),
  source_quote: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning_note: z.string().optional(),
});

const FactExtractionOutputSchema = z.object({
  facts: z.array(ExtractedFactSchema).default([]),
  missing_fields: z.array(z.string()).default([]),
  risk_warnings: z.array(z.string()).default([]),
});

export interface FactValidationResult {
  validFacts: ExtractedFactCandidate[];
  missingFields: string[];
  riskWarnings: string[];
  warnings: string[];
}

export interface ValidationOptions {
  minConfidence?: number;
  chunkTexts: Map<number, string>;
}

export function validateFactExtractionOutput(
  rawJson: unknown,
  options: ValidationOptions,
): FactValidationResult {
  const parseResult = FactExtractionOutputSchema.safeParse(rawJson);
  if (!parseResult.success) {
    return {
      validFacts: [],
      missingFields: [],
      riskWarnings: [],
      warnings: [`输出 JSON 结构校验失败: ${parseResult.error.message}`],
    };
  }

  const {facts, missing_fields, risk_warnings} = parseResult.data;
  const validFacts: ExtractedFactCandidate[] = [];
  const warnings: string[] = [];

  const minConfidence = options.minConfidence ?? 0.3;

  for (const fact of facts) {
    if (!isFactType(fact.fact_type)) {
      warnings.push(`跳过未知 fact_type: ${fact.fact_type}`);
      continue;
    }

    if (fact.confidence < minConfidence) {
      warnings.push(`低置信度跳过 [${fact.fact_type}]: ${fact.fact_value}`);
      continue;
    }

    const chunkText = options.chunkTexts.get(fact.source_chunk_id);
    if (!chunkText) {
      warnings.push(`source_chunk_id ${fact.source_chunk_id} 不存在 [${fact.fact_type}]`);
      continue;
    }

    if (!sourceQuoteExistsInChunk(fact.source_quote, chunkText)) {
      warnings.push(`source_quote 无法溯源 [${fact.fact_type}]: ${fact.source_quote.slice(0, 60)}`);
      continue;
    }

    validFacts.push({
      fact_type: fact.fact_type,
      fact_value: fact.fact_value.trim(),
      source_chunk_id: fact.source_chunk_id,
      source_quote: fact.source_quote.trim(),
      confidence: fact.confidence,
      reasoning_note: fact.reasoning_note,
    });
  }

  return {
    validFacts,
    missingFields: missing_fields,
    riskWarnings: risk_warnings,
    warnings,
  };
}

export function sourceQuoteExistsInChunk(quote: string, chunkText: string): boolean {
  if (chunkText.includes(quote)) {
    return true;
  }
  return normalizeText(chunkText).includes(normalizeText(quote));
}

export function normalizeText(text: string): string {
  return (
    text
      // 统一空白
      .replace(/\s+/g, ' ')
      .trim()
      // 全角标点 → 半角
      .replace(/[，。！？、；：“”‘’（）【】《》]/g, (char) => {
        const map: Record<string, string> = {
          '，': ',',
          '。': '.',
          '！': '!',
          '？': '?',
          '、': ',',
          '；': ';',
          '：': ':',
          '“': '"',
          '”': '"',
          '‘': "'",
          '’': "'",
          '（': '(',
          '）': ')',
          '【': '[',
          '】': ']',
          '《': '<',
          '》': '>',
        };
        return map[char] ?? char;
      })
  );
}
