/**
 * factOntologySkill.ts
 *
 * Implements the "ontology mode" fact extraction path (Phase 6).
 *
 * Step 1: For each non-empty formInput field:
 *   - If a confirmed fact with the same fact_type already exists, deprecate it first.
 *   - Write a new confirmed fact with extraction_model = 'user_input'.
 *
 * Step 2: Compute missing fields (14 types - filled-by-form - already-confirmed).
 *   If no missing fields or no knowledge chunks, skip LLM step.
 *
 * Step 3: Call LLM (fact_extraction role) with an ontology-aware prompt that
 *   tells it which fields are already filled and asks it to fill only the rest.
 *
 * Step 4: Parse + validate LLM output using existing pipeline.
 *   Write valid fields as candidate facts.
 *
 * Step 5: Return FactExtractionResult with counts, warnings, missingFields, riskWarnings.
 */

import {getDb} from '../../db/connection.ts';
import {chat} from '../llmService.ts';
import {FACT_TYPES, FACT_TYPE_LABELS, HIGH_RISK_FACT_TYPES, REQUIRED_FACT_TYPES_FOR_ARTICLE, isFactType, type FactType, type FactExtractionResult} from './factTypes.ts';
import {type FactChunkContext, buildOntologyFillMessages, FACT_EXTRACTION_PROMPT_VERSION, FACT_ONTOLOGY_PROMPT_VERSION} from './factPromptBuilder.ts';
import {validateFactExtractionOutput} from './factExtractionValidator.ts';
import {normalizeFactCandidates, type NormalizedFactCandidate} from './factNormalizationService.ts';
import {
  createFact,
  type CreateFactInput,
  listFacts,
  deprecateFact,
} from './factRepository.ts';


export interface OntologySkillInput {
  projectId: number;
  formInputs: Record<string, string>;
  /** Optional — if provided, limits chunk retrieval to those chunk IDs */
  chunkIds?: number[];
  /** Optional — if provided, limits chunk retrieval to a single KB entry */
  entryId?: number;
  signal?: AbortSignal;
}

interface ChunkRow {
  id: number;
  entry_id: number;
  title: string;
  chunk_text: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runFactOntologySkill(input: OntologySkillInput): Promise<FactExtractionResult> {
  const {projectId, formInputs} = input;

  // Step 1 — Process user-input fields from the form
  const {confirmedIds, filledTypes, warnings: formWarnings} = processFormInputs(projectId, formInputs);

  // Step 2 — Determine missing fields
  const alreadyConfirmedTypes = getConfirmedFactTypes(projectId);
  const coveredTypes = new Set([...filledTypes, ...alreadyConfirmedTypes]);
  const missingTypes = FACT_TYPES.filter((t) => !coveredTypes.has(t));

  // Fetch knowledge chunks
  const chunks = fetchChunks(input);

  // Skip LLM if nothing is missing or there are no chunks
  if (missingTypes.length === 0 || chunks.length === 0) {
    const missingFields = computeMissingRequiredFields(projectId, filledTypes);
    const riskWarnings = computeRiskWarnings(filledTypes, []);
    return {
      extractedCount: confirmedIds.length,
      factIds: confirmedIds,
      warnings: formWarnings,
      missingFields,
      riskWarnings,
    };
  }

  // Step 3 — Build prompt and call LLM
  const projectName = getProjectName(projectId);
  const {system, user} = buildOntologyFillMessages({
    chunks,
    projectName,
    alreadyFilledTypes: Array.from(coveredTypes),
  });

  let llmCandidateIds: number[] = [];
  let llmWarnings: string[] = [];
  let llmCandidateTypes: string[] = [];

  try {
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
      llmWarnings.push('LLM 输出不是合法 JSON，跳过文档补全');
    } else {
      // Step 4 — Validate and normalize
      const chunkTexts = new Map(chunks.map((c) => [c.chunkId, c.chunkText]));
      const validation = validateFactExtractionOutput(rawJson, {chunkTexts});
      llmWarnings.push(...validation.warnings);

      const normalizedCandidates = normalizeFactCandidates(validation.validFacts);
      const chunkIdToEntryId = new Map(chunks.map((c) => [c.chunkId, c.entryId]));
      llmCandidateIds = insertCandidatesAsFacts(
        projectId,
        normalizedCandidates,
        chunkIdToEntryId,
        response.model,
      );
      llmCandidateTypes = normalizedCandidates.map((c) => c.fact_type);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    llmWarnings.push(`LLM 补全调用失败: ${message}，手填内容已保存`);
  }

  // Step 5 — Build result
  const allFactIds = [...confirmedIds, ...llmCandidateIds];
  const missingFields = computeMissingRequiredFields(projectId, filledTypes);
  const riskWarnings = computeRiskWarnings(filledTypes, llmCandidateTypes);
  const allWarnings = [...formWarnings, ...llmWarnings];

  return {
    extractedCount: allFactIds.length,
    factIds: allFactIds,
    warnings: allWarnings,
    missingFields,
    riskWarnings,
  };
}

// ---------------------------------------------------------------------------
// Step 1 helpers
// ---------------------------------------------------------------------------

function processFormInputs(
  projectId: number,
  formInputs: Record<string, string>,
): {confirmedIds: number[]; filledTypes: Set<FactType>; warnings: string[]} {
  const confirmedIds: number[] = [];
  const filledTypes = new Set<FactType>();
  const warnings: string[] = [];
  const db = getDb();
  const insertConfirmed = db.transaction(() => {
    for (const [rawType, rawValue] of Object.entries(formInputs)) {
      const value = rawValue?.trim();
      if (!value) continue; // skip empty

      if (!isFactType(rawType)) {
        warnings.push(`忽略未知字段: ${rawType}`);
        continue;
      }

      const factType = rawType as FactType;

      // Find existing confirmed facts of the same type so we can deprecate them after insertion
      const {facts: existing} = listFacts({
        projectId,
        status: 'confirmed',
        factType,
      });

      const input: CreateFactInput = {
        project_id: projectId,
        fact_type: factType,
        fact_key: factType,
        fact_value: value,
        confidence: 1.0,
        source_entry_id: null,
        source_chunk_id: null,
        source_quote: null,
        extraction_model: 'user_input',
        extraction_prompt_version: FACT_EXTRACTION_PROMPT_VERSION,
        status: 'confirmed',
      };
      const fact = createFact(input);
      confirmedIds.push(fact.id);
      filledTypes.add(factType);

      // Deprecate old confirmed records, pointing them to the new one
      for (const existingFact of existing) {
        deprecateFact(existingFact.id, fact.id);
      }
    }
  });

  insertConfirmed();
  return {confirmedIds, filledTypes, warnings};
}

// ---------------------------------------------------------------------------
// Chunk retrieval
// ---------------------------------------------------------------------------

function fetchChunks(input: OntologySkillInput): FactChunkContext[] {
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

// ---------------------------------------------------------------------------
// Insert LLM candidates
// ---------------------------------------------------------------------------

function insertCandidatesAsFacts(
  projectId: number,
  candidates: NormalizedFactCandidate[],
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
        fact_key: c.fact_key ?? c.fact_type,
        fact_value: c.normalized_value ?? c.fact_value,
        confidence: c.confidence,
        source_entry_id: entryId,
        source_chunk_id: c.source_chunk_id,
        source_quote: c.source_quote,
        extraction_model: modelName,
        extraction_prompt_version: FACT_ONTOLOGY_PROMPT_VERSION,
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

// ---------------------------------------------------------------------------
// Post-processing helpers
// ---------------------------------------------------------------------------

function getConfirmedFactTypes(projectId: number): Set<string> {
  const {facts} = listFacts({projectId, status: 'confirmed'});
  return new Set(facts.map((f) => f.fact_type));
}

function getProjectName(projectId: number): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
    | {name: string}
    | undefined;
  return row?.name;
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

function computeMissingRequiredFields(
  projectId: number,
  justFilledTypes: Set<FactType>,
): string[] {
  const confirmedTypes = getConfirmedFactTypes(projectId);
  const combined = new Set([...confirmedTypes, ...justFilledTypes]);
  return REQUIRED_FACT_TYPES_FOR_ARTICLE.filter((t) => !combined.has(t));
}

function computeRiskWarnings(
  formFilledTypes: Set<FactType>,
  llmFilledTypes: string[],
): string[] {
  const riskWarnings: string[] = [];
  const llmFilledSet = new Set(llmFilledTypes);

  for (const riskType of HIGH_RISK_FACT_TYPES) {
    if (llmFilledSet.has(riskType) && !formFilledTypes.has(riskType)) {
      riskWarnings.push(
        `高风险字段「${FACT_TYPE_LABELS[riskType]}」由 AI 从文档补全，请仔细核实`,
      );
    }
  }

  return riskWarnings;
}
