import {chat} from '../llmService.ts';
import {getProject} from '../projectService.ts';
import {getDb} from '../../db/connection.ts';
import type {SourceRecommendation} from '@/types/domain';

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
