import {embedText} from './embedding.ts';
import {searchSimilarChunks} from './vectorStore.ts';
import {chat} from './llmService.ts';
import {getDb} from '../db/connection.ts';
import {getMissingFieldsAndWarnings} from './facts/pendingFactReviewService.ts';
import {loadPrompt} from '../prompts/loader.ts';

export interface RagSource {
  chunkId: number;
  entryId: number;
  entryTitle: string;
  chunkText: string;
  chunkIndex: number;
  sourceType: string | null;
  sourceFilePath: string | null;
}

export interface EvidenceFact {
  factId: number;
  factType: string;
  factKey: string;
  factValue: string | null;
  confidence: number;
}

export interface EvidenceChunk extends RagSource {
  vectorDistance?: number;
  ftsRank?: number;
  keywordScore: number;
  qualityScore: number;
  combinedScore: number;
}

export interface EvidencePack {
  projectId: number;
  query: string;
  facts: EvidenceFact[];
  chunks: EvidenceChunk[];
  missingFields: string[];
  riskWarnings: string[];
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
  evidence: EvidencePack;
  model: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^一-龥a-z0-9]+/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function overlapScore(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = text.toLowerCase();
  const hits = tokens.filter((t) => normalized.includes(t)).length;
  return hits / tokens.length;
}

function qualityWeight(score: number): number {
  if (score >= 0.6) return 1;
  if (score >= 0.3) return 0.6;
  return 0;
}

export async function buildEvidencePack(
  projectId: number,
  query: string,
  topK = 5,
): Promise<EvidencePack> {
  const db = getDb();
  const tokens = tokenize(query);

  // 1. 企业事实（仅已确认）
  const factRows = db
    .prepare(
      `SELECT id, fact_type, fact_key, fact_value, confidence
       FROM enterprise_facts
       WHERE project_id = ? AND status = 'confirmed'`,
    )
    .all(projectId) as Array<{
    id: number;
    fact_type: string;
    fact_key: string;
    fact_value: string | null;
    confidence: number;
  }>;

  const facts: EvidenceFact[] = factRows
    .map((f) => {
      const text = `${f.fact_key} ${f.fact_value ?? ''}`;
      const score =
        (f.confidence ?? 1) * (0.5 + 0.5 * overlapScore(text, tokens));
      return {
        factId: f.id,
        factType: f.fact_type,
        factKey: f.fact_key,
        factValue: f.fact_value,
        confidence: f.confidence,
        _score: score,
      };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, Math.max(3, Math.floor(topK / 2)))
    .map(({_score, ...rest}) => rest);

  const {missing, riskWarnings} = getMissingFieldsAndWarnings(projectId);

  // 2. FTS5 关键词召回
  const candidateLimit = Math.max(topK * 4, 20);
  const ftsCandidates = new Map<number, EvidenceChunk>();
  if (tokens.length > 0) {
    const matchExpr = tokens
      .map((t) => '"' + t.replace(/"/g, '""') + '"')
      .join(' ');
    const ftsRows = db
      .prepare(
        `SELECT
           fts.rowid,
           fts.rank,
           c.id AS chunk_id,
           c.chunk_text,
           c.chunk_index,
           c.quality_score,
           e.id AS entry_id,
           e.title AS entry_title,
           e.source_type,
           e.source_file_path
         FROM knowledge_chunk_fts fts
         JOIN knowledge_chunks c ON c.id = fts.rowid
         JOIN knowledge_entries e ON e.id = c.entry_id
         WHERE knowledge_chunk_fts MATCH ?
           AND e.project_id = ?
           AND c.quality_score >= 0.3
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(matchExpr, projectId, candidateLimit) as Array<{
      rowid: number;
      rank: number;
      chunk_id: number;
      chunk_text: string;
      chunk_index: number;
      quality_score: number;
      entry_id: number;
      entry_title: string;
      source_type: string | null;
      source_file_path: string | null;
    }>;

    for (const row of ftsRows) {
      const text = `${row.entry_title} ${row.chunk_text}`;
      const kScore = overlapScore(text, tokens);
      ftsCandidates.set(row.chunk_id, {
        chunkId: row.chunk_id,
        entryId: row.entry_id,
        entryTitle: row.entry_title,
        chunkText: row.chunk_text,
        chunkIndex: row.chunk_index,
        sourceType: row.source_type,
        sourceFilePath: row.source_file_path,
        ftsRank: row.rank,
        keywordScore: kScore,
        qualityScore: row.quality_score,
        combinedScore: 0,
      });
    }
  }

  // 3. 向量召回
  const queryVector = await embedText(query);
  const vecRows = searchSimilarChunks(projectId, queryVector, candidateLimit);
  for (const row of vecRows) {
    const text = `${row.entryTitle} ${row.chunkText}`;
    const existing = ftsCandidates.get(row.chunkId);
    const kScore = overlapScore(text, tokens);
    if (existing) {
      existing.vectorDistance = row.distance;
      existing.keywordScore = Math.max(existing.keywordScore, kScore);
    } else {
      // fetch quality_score if not in FTS candidates
      const qualityRow = db
        .prepare('SELECT quality_score FROM knowledge_chunks WHERE id = ?')
        .get(row.chunkId) as {quality_score: number} | undefined;
      ftsCandidates.set(row.chunkId, {
        chunkId: row.chunkId,
        entryId: row.entryId,
        entryTitle: row.entryTitle,
        chunkText: row.chunkText,
        chunkIndex: row.chunkIndex,
        sourceType: row.sourceType,
        sourceFilePath: row.sourceFilePath,
        vectorDistance: row.distance,
        keywordScore: kScore,
        qualityScore: qualityRow?.quality_score ?? 0,
        combinedScore: 0,
      });
    }
  }

  // 4. 重排
  const scored = Array.from(ftsCandidates.values()).map((c) => {
    const vectorScore = c.vectorDistance != null ? 1 / (1 + c.vectorDistance) : 0;
    const ftsBoost =
      c.ftsRank != null ? 1 / (1 + Math.abs(c.ftsRank)) : 0;
    const qWeight = qualityWeight(c.qualityScore);
    const combined =
      vectorScore * 0.45 + c.keywordScore * 0.35 + ftsBoost * 0.1 + qWeight * 0.1;
    return {...c, combinedScore: combined};
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);
  const chunks = scored.slice(0, topK);

  return {
    projectId,
    query,
    facts,
    chunks,
    missingFields: missing,
    riskWarnings: riskWarnings,
  };
}

export function formatEvidence(evidence: EvidencePack): string {
  const factPart =
    evidence.facts.length > 0
      ? evidence.facts
          .map(
            (f, i) =>
              `[^F${i + 1}^] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`,
          )
          .join('\n')
      : '（暂无相关企业事实）';

  const chunkPart =
    evidence.chunks.length > 0
      ? evidence.chunks
          .map(
            (c, i) =>
              `[^${i + 1}^] 标题：${c.entryTitle}\n来源：${
                c.sourceType === 'file' ? c.sourceFilePath : '文本'
              }\n内容：${c.chunkText}`,
          )
          .join('\n\n---\n\n')
      : '（暂无相关参考资料）';

  return `企业事实：\n${factPart}\n\n参考资料：\n\n${chunkPart}`;
}

export async function askQuestion(
  projectId: number,
  query: string,
  limit = 5,
): Promise<RagAnswer> {
  const evidence = await buildEvidencePack(projectId, query, limit);

  if (evidence.chunks.length === 0 && evidence.facts.length === 0) {
    return {
      answer:
        '当前知识库中没有找到与问题相关的资料。请先上传企业资料或录入文本。',
      sources: [],
      evidence,
      model: '',
    };
  }

  const context = formatEvidence(evidence);
  const userPrompt = `问题：${query}\n\n${context}\n\n请根据以上信息回答问题。`;

  const response = await chat('chat', [
    {role: 'system', content: loadPrompt('qa')},
    {role: 'user', content: userPrompt},
  ]);

  return {
    answer: response.content,
    sources: evidence.chunks.map((c) => ({
      chunkId: c.chunkId,
      entryId: c.entryId,
      entryTitle: c.entryTitle,
      chunkText: c.chunkText,
      chunkIndex: c.chunkIndex,
      sourceType: c.sourceType,
      sourceFilePath: c.sourceFilePath,
    })),
    evidence,
    model: response.model,
  };
}
