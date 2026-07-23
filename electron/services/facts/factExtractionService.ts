import {getDb} from '../../db/connection.ts';
import {chat} from '../llmService.ts';
import type {ExtractedFactCandidate} from '@/types/domain';
import {
  buildFactExtractionMessages,
  FACT_EXTRACTION_PROMPT_VERSION,
  type FactChunkContext,
} from './factPromptBuilder.ts';
import {validateFactExtractionOutput} from './factExtractionValidator.ts';
import {normalizeFactCandidates} from './factNormalizationService.ts';
import {createFact, type CreateFactInput} from './factRepository.ts';
import {FACT_TYPES, type FactExtractionResult, type FactType, isFactType} from './factTypes.ts';

export interface ExtractFactsInput {
  projectId: number;
  entryId?: number;
  chunkIds?: number[];
  /**
   * Optional domain-specific narrowing of the fact_type set the extractor
   * should look for. When omitted, the full FACT_TYPES list is used.
   * Passed through to the prompt builder and validator so only
   * domain-relevant types are extracted.
   */
  factTypes?: string[];
  signal?: AbortSignal;
}

interface ChunkRow {
  id: number;
  entry_id: number;
  title: string;
  chunk_text: string;
}

export async function extractFacts(input: ExtractFactsInput): Promise<FactExtractionResult> {
  const projectName = getProjectName(input.projectId);
  const chunks = fetchChunks(input);

  if (chunks.length === 0) {
    return {
      extractedCount: 0,
      factIds: [],
      warnings: ['未找到可抽取的知识片段'],
      missingFields: [],
      riskWarnings: [],
    };
  }

  // Resolve the effective fact_type set: caller can narrow it for a domain,
  // otherwise the full ontology is used.
  const effectiveFactTypes = resolveEffectiveFactTypes(input.factTypes);

  const {system, user} = buildFactExtractionMessages({chunks, projectName, factTypes: effectiveFactTypes});
  const response = await chat(
    'fact_extraction',
    [
      {role: 'system', content: system},
      {role: 'user', content: user},
    ],
    {responseFormat: 'json_object'},
  );

  const rawJson = safeParseJson(response.content);
  if (rawJson === undefined) {
    return {
      extractedCount: 0,
      factIds: [],
      warnings: ['模型输出不是合法 JSON'],
      missingFields: [],
      riskWarnings: [],
    };
  }

  const chunkTexts = new Map(chunks.map((c) => [c.chunkId, c.chunkText]));
  const validation = validateFactExtractionOutput(rawJson, {chunkTexts, allowedFactTypes: effectiveFactTypes});

  const normalizedCandidates = normalizeFactCandidates(validation.validFacts);
  if (normalizedCandidates.length === 0) {
    return {
      extractedCount: 0,
      factIds: [],
      warnings: validation.warnings,
      missingFields: validation.missingFields,
      riskWarnings: validation.riskWarnings,
    };
  }

  const chunkIdToEntryId = new Map(chunks.map((c) => [c.chunkId, c.entryId]));
  const factIds = insertCandidatesAsFacts(
    input.projectId,
    normalizedCandidates,
    chunkIdToEntryId,
    response.model,
  );

  return {
    extractedCount: factIds.length,
    factIds,
    warnings: validation.warnings,
    missingFields: validation.missingFields,
    riskWarnings: validation.riskWarnings,
  };
}

function fetchChunks(input: ExtractFactsInput): FactChunkContext[] {
  const db = getDb();
  const conditions = ['ke.project_id = ?'];
  const params: unknown[] = [input.projectId];

  if (input.entryId !== undefined) {
    conditions.push('kc.entry_id = ?');
    params.push(input.entryId);
  }

  if (input.chunkIds !== undefined && input.chunkIds.length > 0) {
    const placeholders = input.chunkIds.map(() => '?').join(',');
    conditions.push(`kc.id IN (${placeholders})`);
    params.push(...input.chunkIds);
  }

  const rows = db
    .prepare(
      `SELECT kc.id, kc.entry_id, ke.title, kc.chunk_text
       FROM knowledge_chunks kc
       JOIN knowledge_entries ke ON kc.entry_id = ke.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY kc.entry_id, kc.chunk_index`,
    )
    .all(...params) as ChunkRow[];

  return rows.map((r) => ({
    chunkId: r.id,
    entryId: r.entry_id,
    entryTitle: r.title,
    chunkText: r.chunk_text,
  }));
}

function getProjectName(projectId: number): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
    | {name: string}
    | undefined;
  return row?.name;
}

/**
 * Resolves the effective fact_type set for a call. If the caller passes a
 * non-empty domain-narrowed list, intersect it with the known FACT_TYPES
 * (dropping any invalid types) and return that. Otherwise return undefined,
 * meaning "use the full ontology".
 */
function resolveEffectiveFactTypes(factTypes?: string[]): readonly FactType[] | undefined {
  if (!factTypes || factTypes.length === 0) return undefined;
  const filtered = factTypes.filter((t): t is FactType => isFactType(t));
  return filtered.length > 0 ? filtered : undefined;
}

function safeParseJson(content: string): unknown | undefined {
  const trimmed = content.trim();
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  const payload = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;

  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function insertCandidatesAsFacts(
  projectId: number,
  candidates: ExtractedFactCandidate[],
  chunkIdToEntryId: Map<number, number>,
  modelName: string,
): number[] {
  const db = getDb();
  const factIds: number[] = [];

  const insert = db.transaction(() => {
    for (const c of candidates) {
      const entryId = chunkIdToEntryId.get(c.source_chunk_id) ?? null;
      const createInput: CreateFactInput = {
        project_id: projectId,
        fact_type: c.fact_type,
        fact_key: c.fact_type,
        fact_value: c.normalized_value ?? c.fact_value,
        confidence: c.confidence,
        source_entry_id: entryId,
        source_chunk_id: c.source_chunk_id,
        source_quote: c.source_quote,
        extraction_model: modelName,
        extraction_prompt_version: FACT_EXTRACTION_PROMPT_VERSION,
        status: 'candidate',
        extracted_json: JSON.stringify(c),
      };
      const fact = createFact(createInput);
      factIds.push(fact.id);
    }
  });

  insert();
  return factIds;
}
