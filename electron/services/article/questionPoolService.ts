import {buildEvidencePack} from '../ragService.ts';
import {chat} from '../llmService.ts';
import {getDb} from '../../db/connection.ts';
import type {QuestionPoolItem} from '@/types/domain';

interface QuestionPoolRow {
  id: number;
  project_id: number;
  question_text: string;
  status: 'candidate' | 'selected' | 'rejected';
  score: number | null;
  score_reason: string | null;
}

interface RawQuestion {
  questionText: string;
  score: number;
  scoreReason: string;
}

interface QuestionGenerationResponse {
  questions: RawQuestion[];
}

function mapRow(row: QuestionPoolRow): QuestionPoolItem {
  return {
    id: row.id,
    projectId: row.project_id,
    questionText: row.question_text,
    status: row.status,
    score: row.score ?? undefined,
    scoreReason: row.score_reason ?? undefined,
  };
}

export async function generateQuestions(projectId: number): Promise<QuestionPoolItem[]> {
  const evidence = await buildEvidencePack(projectId, '');

  if (evidence.facts.length === 0) {
    return [];
  }

  const formattedFacts = evidence.facts
    .map((f) => `- [${f.factType}] ${f.factKey}: ${f.factValue ?? ''}`)
    .join('\n');

  const messages = [
    {
      role: 'system' as const,
      content: `你是企业 GEO 优化问题分析师。基于提供的企业事实，生成 5-10 个用户最可能向 AI 提问的目标问题。
要求：
1. 问题格式：听起来像用户向 AI 提问，包含行业/产品/服务，含决策意图（推荐/排行榜/怎么选/哪家好）
2. 每个问题包含 questionText、score（0-1，代表商业价值）、scoreReason
3. 以 JSON 格式输出：{"questions": [{"questionText": "...", "score": 0.8, "scoreReason": "..."}]}
4. 只使用提供的企业事实，不要编造信息`,
    },
    {
      role: 'user' as const,
      content: `以下是企业事实：\n${formattedFacts}\n\n请生成目标问题。`,
    },
  ];

  let parsedResponse: QuestionGenerationResponse;
  try {
    const response = await chat('question_generation', messages, {responseFormat: 'json_object'});
    parsedResponse = JSON.parse(response.content) as QuestionGenerationResponse;
  } catch (err) {
    console.error('[questionPoolService] Failed to call LLM or parse response:', err);
    return [];
  }

  if (!Array.isArray(parsedResponse?.questions) || parsedResponse.questions.length === 0) {
    return [];
  }

  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO question_pools (project_id, question_text, question_type, status, score, score_reason)
    VALUES (?, ?, 'target', 'candidate', ?, ?)
  `);

  const insertedRows: QuestionPoolItem[] = [];

  const insertMany = db.transaction((questions: RawQuestion[]) => {
    for (const q of questions) {
      const questionText = typeof q.questionText === 'string' ? q.questionText.trim() : '';
      if (!questionText) continue;
      const score = typeof q.score === 'number' ? q.score : null;
      const scoreReason = typeof q.scoreReason === 'string' ? q.scoreReason : null;
      const result = insertStmt.run(projectId, questionText, score, scoreReason);
      const row = db
        .prepare('SELECT * FROM question_pools WHERE id = ?')
        .get(result.lastInsertRowid) as QuestionPoolRow | undefined;
      if (row) {
        insertedRows.push(mapRow(row));
      }
    }
  });

  try {
    insertMany(parsedResponse.questions);
  } catch (err) {
    console.error('[questionPoolService] Failed to insert questions into DB:', err);
    return [];
  }

  return insertedRows;
}

export function selectQuestion(id: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE question_pools SET status = 'selected', updated_at = unixepoch() WHERE id = ?`,
  ).run(id);
}

export function rejectQuestion(id: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE question_pools SET status = 'rejected', updated_at = unixepoch() WHERE id = ?`,
  ).run(id);
}

export function listQuestions(projectId: number): QuestionPoolItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM question_pools WHERE project_id = ? ORDER BY score DESC, created_at DESC`,
    )
    .all(projectId) as QuestionPoolRow[];
  return rows.map(mapRow);
}
