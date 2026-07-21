import {getDb} from '../../db/connection.ts';
import type {EnterpriseFact, FactStatus} from '@/types/domain';

export interface CreateFactInput {
  project_id: number;
  fact_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
  source_entry_id: number | null;
  source_chunk_id: number | null;
  source_quote: string | null;
  extraction_model: string | null;
  extraction_prompt_version: string | null;
  status?: FactStatus;
  replaces_fact_id?: number | null;
  extracted_json?: string | null;
}

export interface ListFactsFilters {
  projectId: number;
  status?: FactStatus;
  factType?: string;
  limit?: number;
  offset?: number;
}

export function createFact(input: CreateFactInput): EnterpriseFact {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO enterprise_facts (
         project_id, fact_type, fact_key, fact_value, confidence,
         source_entry_id, source_chunk_id, source_quote,
         extraction_model, extraction_prompt_version, status,
         replaces_fact_id, extracted_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      input.project_id,
      input.fact_type,
      input.fact_key,
      input.fact_value,
      input.confidence,
      input.source_entry_id ?? null,
      input.source_chunk_id ?? null,
      input.source_quote ?? null,
      input.extraction_model ?? null,
      input.extraction_prompt_version ?? null,
      input.status ?? 'candidate',
      input.replaces_fact_id ?? null,
      input.extracted_json ?? null,
    );
  return getFactById(Number(result.lastInsertRowid))!;
}

export function getFactById(id: number): EnterpriseFact | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM enterprise_facts WHERE id = ?').get(id) as
    | EnterpriseFact
    | undefined;
}

export function listFacts(filters: ListFactsFilters): {
  facts: EnterpriseFact[];
  total: number;
} {
  const db = getDb();
  const conditions: string[] = ['project_id = ?'];
  const params: unknown[] = [filters.projectId];

  if (filters.status !== undefined) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.factType !== undefined) {
    conditions.push('fact_type = ?');
    params.push(filters.factType);
  }

  const whereClause = conditions.join(' AND ');
  const total = (
    db
      .prepare(`SELECT COUNT(*) as c FROM enterprise_facts WHERE ${whereClause}`)
      .get(...params) as {c: number}
  ).c;

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  const facts = db
    .prepare(
      `SELECT * FROM enterprise_facts WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as EnterpriseFact[];

  return {facts, total};
}

export function listPendingFacts(projectId: number): EnterpriseFact[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM enterprise_facts WHERE project_id = ? AND status = 'candidate' ORDER BY created_at DESC",
    )
    .all(projectId) as EnterpriseFact[];
}

export function listFactsByEntry(entryId: number): EnterpriseFact[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM enterprise_facts WHERE source_entry_id = ? ORDER BY created_at DESC')
    .all(entryId) as EnterpriseFact[];
}

export function updateFactStatus(
  id: number,
  status: FactStatus,
  options?: {
    reviewedBy?: string;
    reviewMetadataJson?: string;
  },
): void {
  const db = getDb();
  db.prepare(
    `UPDATE enterprise_facts
     SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?, review_metadata_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    status,
    options?.reviewedBy ?? null,
    options?.reviewMetadataJson ?? null,
    id,
  );
}

export function updateFactValue(
  id: number,
  updates: {
    factValue: string;
    factType?: string;
    factKey?: string;
    reviewMetadataJson?: string;
    reviewedBy?: string;
  },
): void {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];

  fields.push('fact_value = ?');
  params.push(updates.factValue);

  if (updates.factType !== undefined) {
    fields.push('fact_type = ?');
    params.push(updates.factType);
    fields.push('fact_key = ?');
    params.push(updates.factKey ?? updates.factType);
  }

  fields.push('reviewed_at = datetime(\'now\')');
  fields.push('reviewed_by = ?');
  params.push(updates.reviewedBy ?? null);
  fields.push('review_metadata_json = ?');
  params.push(updates.reviewMetadataJson ?? null);
  fields.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE enterprise_facts SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deprecateFact(id: number, replacedById: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE enterprise_facts
     SET status = 'deprecated', replaces_fact_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(replacedById, id);
}

export function countFactsByStatus(projectId: number): Record<FactStatus, number> {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT status, COUNT(*) as c FROM enterprise_facts WHERE project_id = ? GROUP BY status',
    )
    .all(projectId) as Array<{status: FactStatus; c: number}>;
  const result: Record<FactStatus, number> = {
    candidate: 0,
    confirmed: 0,
    rejected: 0,
    deprecated: 0,
  };
  for (const row of rows) {
    result[row.status] = row.c;
  }
  return result;
}

export function hasConfirmedFactType(projectId: number, factType: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT 1 as has_one FROM enterprise_facts WHERE project_id = ? AND fact_type = ? AND status = 'confirmed' LIMIT 1",
    )
    .get(projectId, factType) as {has_one: number} | undefined;
  return row !== undefined;
}

export function hasHighConfidenceCandidate(projectId: number, threshold = 0.7): boolean {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT 1 as has_one FROM enterprise_facts WHERE project_id = ? AND status = 'candidate' AND confidence >= ? LIMIT 1",
    )
    .get(projectId, threshold) as {has_one: number} | undefined;
  return row !== undefined;
}
