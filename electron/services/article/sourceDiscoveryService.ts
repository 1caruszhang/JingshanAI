import {chat} from '../llmService.ts';
import {getProject} from '../projectService.ts';
import {getDb} from '../../db/connection.ts';
import type {SourceDecision, SourceRecommendation} from '@/types/domain';

const SYSTEM_PROMPT = `你是企业 GEO 优化顾问。基于目标问题和行业背景，推荐 3-5 个高质量外部参考信源。
要求：
1. 信源必须是真实存在的知名网站/媒体（例如行业协会、知名媒体、研究机构）
2. 每个信源包含 url、title、relevanceReason
3. 以 JSON 格式输出：{"sources": [{"url": "https://...", "title": "...", "relevanceReason": "..."}]}
4. 不要编造 URL，只推荐你确认存在的网站`;

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isSourceRecommendation(obj: unknown): obj is SourceRecommendation {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return (
    typeof record.url === 'string' &&
    typeof record.title === 'string' &&
    typeof record.relevanceReason === 'string'
  );
}

export async function discoverSources(
  projectId: number,
  targetQuestion: string,
): Promise<SourceRecommendation[]> {
  const project = getProject(projectId);
  const industry = project?.industry ?? '未指定行业';

  const userPrompt = `行业：${industry}
目标问题：${targetQuestion}

请推荐参考信源。`;

  let sources: SourceRecommendation[] = [];

  try {
    const response = await chat(
      'source_discovery',
      [
        {role: 'system', content: SYSTEM_PROMPT},
        {role: 'user', content: userPrompt},
      ],
      {responseFormat: 'json_object'},
    );

    const parsed = safeParseJson(response.content);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.sources)) {
        sources = (record.sources as unknown[])
          .filter(isSourceRecommendation);
      }
    }
  } catch (err) {
    console.error('[sourceDiscoveryService] LLM call failed:', err);
    return [];
  }

  // Persist to article_artifacts_meta.source_recommendation if an artifact exists
  try {
    const db = getDb();
    const latestMeta = db
      .prepare(
        `SELECT m.id FROM article_artifacts_meta m
         JOIN agent_artifacts a ON a.id = m.artifact_id
         WHERE a.project_id = ?
         ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(projectId) as {id: number} | undefined;

    if (latestMeta) {
      db.prepare(
        `UPDATE article_artifacts_meta SET source_recommendation = ? WHERE id = ?`,
      ).run(JSON.stringify(sources), latestMeta.id);
    }
  } catch (err) {
    console.warn('[sourceDiscoveryService] Failed to persist source_recommendation:', err);
  }

  return sources;
}

// ── Source decision persistence (source_decisions table) ─────────────────────
//
// SourceDiscoveryView 的「采用 / 跳过」决策以 project_id + target_question +
// url 为唯一键持久化，便于用户重新进入视图时恢复状态。upsert 使用 INSERT …
// ON CONFLICT … DO UPDATE，使 adopt/skip 之间可互相切换。

export function upsertSourceDecision(
  projectId: number,
  targetQuestion: string,
  source: SourceRecommendation,
  decision: 'adopted' | 'skipped',
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO source_decisions
       (project_id, target_question, url, title, relevance_reason, decision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(project_id, target_question, url) DO UPDATE SET
       title = excluded.title,
       relevance_reason = excluded.relevance_reason,
       decision = excluded.decision,
       updated_at = datetime('now')`,
  ).run(projectId, targetQuestion, source.url, source.title, source.relevanceReason, decision);
}

export function listSourceDecisions(
  projectId: number,
  targetQuestion: string,
): SourceDecision[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM source_decisions
       WHERE project_id = ? AND target_question = ?
       ORDER BY updated_at ASC`,
    )
    .all(projectId, targetQuestion) as SourceDecision[];
}

export function clearSourceDecisions(projectId: number, targetQuestion: string): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM source_decisions WHERE project_id = ? AND target_question = ?`,
  ).run(projectId, targetQuestion);
}

/**
 * Removes a single source decision (by project + question + url). Used when a
 * user toggles an adopted/skipped source back to undecided.
 */
export function removeSourceDecision(projectId: number, targetQuestion: string, url: string): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM source_decisions WHERE project_id = ? AND target_question = ? AND url = ?`,
  ).run(projectId, targetQuestion, url);
}
