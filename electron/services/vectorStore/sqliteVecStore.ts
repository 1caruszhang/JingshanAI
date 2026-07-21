import type {Database} from 'better-sqlite3';
import {getDb} from '../../db/connection.ts';
import type {VectorSearchResult} from './types.ts';

const VIRTUAL_TABLE = 'vec_knowledge_embeddings';
const MAPPING_TABLE = 'knowledge_chunk_vectors';
const META_TABLE = 'vector_store_meta';
const DEFAULT_MODEL = 'default';

function getMeta(db: Database, key: string): string | undefined {
  const row = db
    .prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`)
    .get(key) as {value: string} | undefined;
  return row?.value;
}

function setMeta(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ${META_TABLE} (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

function hasVirtualTable(db: Database): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(VIRTUAL_TABLE) as {name: string} | undefined;
  return !!row;
}

function ensureVirtualTable(db: Database, dimension: number): void {
  const storedDimRaw = getMeta(db, 'embedding_dim');
  if (storedDimRaw) {
    const storedDim = parseInt(storedDimRaw, 10);
    if (storedDim !== dimension) {
      throw new Error(
        `Embedding dimension changed from ${storedDim} to ${dimension}. ` +
          'All embeddings in the vector store must use the same dimension.',
      );
    }
    if (!hasVirtualTable(db)) {
      db.exec(
        `CREATE VIRTUAL TABLE ${VIRTUAL_TABLE} USING vec0(embedding float[${dimension}])`,
      );
    }
    return;
  }

  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${VIRTUAL_TABLE} USING vec0(embedding float[${dimension}])`,
  );
  setMeta(db, 'embedding_dim', String(dimension));
  setMeta(db, 'embedding_model', DEFAULT_MODEL);
}

function placeholders(count: number): string {
  return Array.from({length: count}, () => '?').join(',');
}

function deleteMappingsByChunkIds(db: Database, chunkIds: number[]): void {
  if (chunkIds.length === 0) return;

  const ph = placeholders(chunkIds.length);
  const rows = db
    .prepare(`SELECT vec_rowid FROM ${MAPPING_TABLE} WHERE chunk_id IN (${ph})`)
    .all(...chunkIds) as Array<{vec_rowid: number}>;

  if (rows.length > 0) {
    const rowids = rows.map((r) => r.vec_rowid);
    db.prepare(
      `DELETE FROM ${VIRTUAL_TABLE} WHERE rowid IN (${placeholders(rowids.length)})`,
    ).run(...rowids);
  }

  db.prepare(
    `DELETE FROM ${MAPPING_TABLE} WHERE chunk_id IN (${ph})`,
  ).run(...chunkIds);
}

export function insertChunkVectors(
  projectId: number,
  chunkIds: number[],
  embeddings: number[][],
  embeddingModel = DEFAULT_MODEL,
): void {
  if (chunkIds.length === 0 || embeddings.length === 0) return;
  if (chunkIds.length !== embeddings.length) {
    throw new Error('chunkIds and embeddings must have the same length');
  }

  const dimension = embeddings[0].length;
  if (dimension === 0) {
    throw new Error('Embedding dimension must be greater than 0');
  }

  const db = getDb();
  ensureVirtualTable(db, dimension);
  deleteMappingsByChunkIds(db, chunkIds);

  const insertVirtual = db.prepare(
    `INSERT INTO ${VIRTUAL_TABLE} (embedding) VALUES (?)`,
  );
  const insertMapping = db.prepare(
    `INSERT INTO ${MAPPING_TABLE} (
      chunk_id, vec_rowid, project_id, embedding_model, embedding_dim
    ) VALUES (?, last_insert_rowid(), ?, ?, ?)`,
  );

  const transaction = db.transaction(() => {
    for (let i = 0; i < chunkIds.length; i++) {
      insertVirtual.run(JSON.stringify(embeddings[i]));
      insertMapping.run(chunkIds[i], projectId, embeddingModel, dimension);
    }
  });
  transaction();
}

export function deleteChunkVectorsByEntry(entryId: number): void {
  const db = getDb();
  const rows = db
    .prepare('SELECT id FROM knowledge_chunks WHERE entry_id = ?')
    .all(entryId) as Array<{id: number}>;
  if (rows.length === 0) return;

  deleteMappingsByChunkIds(
    db,
    rows.map((r) => r.id),
  );
}

export function searchSimilarChunks(
  projectId: number,
  queryVector: number[],
  limit = 5,
): VectorSearchResult[] {
  const dimension = queryVector.length;
  const db = getDb();
  ensureVirtualTable(db, dimension);

  const stmt = db.prepare(
    `SELECT
       m.chunk_id,
       v.distance,
       c.chunk_text,
       c.chunk_index,
       c.entry_id,
       e.title AS entry_title,
       e.source_type,
       e.source_file_path
     FROM (
       SELECT rowid, distance
       FROM ${VIRTUAL_TABLE}
       WHERE embedding MATCH ?
         AND k = ?
     ) v
     JOIN ${MAPPING_TABLE} m ON v.rowid = m.vec_rowid
     JOIN knowledge_chunks c ON m.chunk_id = c.id
     JOIN knowledge_entries e ON c.entry_id = e.id
     WHERE m.project_id = ?
     ORDER BY v.distance`,
  );

  const rows = stmt.all(
    JSON.stringify(queryVector),
    limit,
    projectId,
  ) as Array<{
    chunk_id: number;
    distance: number;
    chunk_text: string;
    chunk_index: number;
    entry_id: number;
    entry_title: string;
    source_type: string | null;
    source_file_path: string | null;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    distance: row.distance,
    chunkText: row.chunk_text,
    chunkIndex: row.chunk_index,
    entryId: row.entry_id,
    entryTitle: row.entry_title,
    sourceType: row.source_type,
    sourceFilePath: row.source_file_path,
  }));
}

export function hasVectorStore(): boolean {
  const db = getDb();
  return hasVirtualTable(db);
}
