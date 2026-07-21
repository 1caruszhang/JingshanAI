import {z} from 'zod';
import {chat} from '../llmService.ts';
import {
  getArtifactById,
  getArticleMetaByArtifactId,
  getReviewsByArtifactId,
  createReview,
  updateArticleStatus,
} from './articleRepository.ts';

const SYSTEM_PROMPT = `你是一名 GEO（生成式引擎优化）内容审核助手。请从以下维度评估一篇文章是否适合被生成式引擎引用和摘要：

评估维度：
1. 关键信息前置：核心结论、价值主张是否在开头 100 字内出现。
2. 结构清晰：是否使用标题、列表、加粗等格式便于模型解析。
3. 关键词自然出现：目标问题相关的关键词是否自然分布。
4. 事实密度：是否有足够的可验证事实支撑。
5. 可读性：段落是否简短，语言是否直接。
6. 行动号召（CTA）：是否有明确的下一步引导。

输出要求：
- passed：综合评分 ≥70 且没有严重问题时为 true。
- score：0-100 的 GEO 质量评分。
- suggestions：具体的优化建议列表。
- riskWarnings：发现的风险（如关键词堆砌、结构混乱、事实不足等）。

只输出 JSON，不要其他文本。`;

const OutputSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  suggestions: z.array(z.string()),
  riskWarnings: z.array(z.string()),
});

export interface GeoReviewResult {
  reviewId: number;
  passed: boolean;
  score: number;
  suggestions: string[];
  riskWarnings: string[];
}

export async function reviewGeo(artifactId: number): Promise<GeoReviewResult> {
  const artifact = getArtifactById(artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found`);
  }

  const meta = getArticleMetaByArtifactId(artifactId);
  const targetQuestion = meta?.target_question ?? artifact.title ?? '';
  const claimReview = getReviewsByArtifactId(artifactId).find(
    (r) => r.review_type === 'claim',
  );

  const claimReviewSummary = claimReview
    ? `Claim Review 结果：通过=${claimReview.passed === 1}，评分=${claimReview.score ?? '无'}，风险=${(claimReview.risk_warnings_json ? JSON.parse(claimReview.risk_warnings_json) : []).join('; ') || '无'}`
    : '尚未进行 Claim Review';

  const userPrompt = `目标问题：${targetQuestion}

${claimReviewSummary}

文章内容：
${artifact.content ?? ''}

请输出 JSON：
{
  "passed": true|false,
  "score": 0-100,
  "suggestions": ["..."],
  "riskWarnings": ["..."]
}`;

  const response = await chat(
    'geo_style_review',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  const validated = OutputSchema.parse(parsed);

  updateArticleStatus(artifactId, 'geo_reviewed');

  const review = createReview({
    artifactId,
    projectId: artifact.project_id,
    reviewType: 'geo',
    reviewer: 'doubao',
    passed: validated.passed,
    score: validated.score,
    reviewJson: validated,
    riskWarnings: validated.riskWarnings,
  });

  return {
    reviewId: review.id,
    passed: validated.passed,
    score: validated.score,
    suggestions: validated.suggestions,
    riskWarnings: validated.riskWarnings,
  };
}

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
