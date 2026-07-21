import {z} from 'zod';
import {chat} from '../llmService.ts';
import {buildEvidencePack} from '../ragService.ts';
import {
  getArtifactById,
  getArticleMetaByArtifactId,
  getClaimsWithSources,
  createReview,
  updateClaimReviewStatus,
  updateArticleStatus,
} from './articleRepository.ts';

const SYSTEM_PROMPT = `你是一名事实核查助手。你的任务是对比文章 Claim 与提供的企业事实、参考资料，判断每个 Claim 是否有充分证据支持。

审查标准：
1. supported：Claim 的内容能在事实或资料中找到直接依据。
2. unsupported：Claim 的内容与提供的证据矛盾，或完全无依据。
3. needs_source：Claim 看起来合理，但当前证据不足以完全支撑，需要补充来源。

输出要求：
- passed：当且仅当所有 Claim 都被判定为 supported 时为 true。
- score：0-100 的整体证据充分度评分。
- unsupportedClaimIds：被判定为 unsupported 或 needs_source 的 Claim ID 列表。
- riskWarnings：发现的任何风险提示（如数据缺失、来源不足、可能编造等）。

只输出 JSON，不要其他文本。`;

const OutputSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  unsupportedClaimIds: z.array(z.number()),
  riskWarnings: z.array(z.string()),
});

export interface ClaimReviewResult {
  reviewId: number;
  passed: boolean;
  score: number;
  unsupportedClaimIds: number[];
  riskWarnings: string[];
}

export async function reviewClaims(
  artifactId: number,
): Promise<ClaimReviewResult> {
  const artifact = getArtifactById(artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found`);
  }

  const meta = getArticleMetaByArtifactId(artifactId);
  const targetQuestion = meta?.target_question ?? artifact.title ?? '';
  const evidence = await buildEvidencePack(artifact.project_id, targetQuestion);
  const claims = getClaimsWithSources(artifactId);

  if (claims.length === 0) {
    const review = createReview({
      artifactId,
      projectId: artifact.project_id,
      reviewType: 'claim',
      reviewer: 'deepseek',
      passed: false,
      score: 0,
      reviewJson: {message: '没有抽取到 Claim'},
      riskWarnings: ['文章没有可审查的 Claim'],
    });
    return {
      reviewId: review.id,
      passed: false,
      score: 0,
      unsupportedClaimIds: [],
      riskWarnings: ['文章没有可审查的 Claim'],
    };
  }

  const claimsText = claims
    .map((c, idx) => {
      const sources = c.sources
        .map(
          (s) =>
            `    - ${s.source_type} #${s.source_id}: ${s.source_quote?.slice(0, 120) ?? ''}`,
        )
        .join('\n');
      return `[${c.id}] ${c.claim_text}\n  类型：${c.claim_type}，风险：${c.risk_level}\n  来源：\n${sources || '    （无映射来源）'}`;
    })
    .join('\n\n');

  const factsText =
    evidence.facts.length > 0
      ? evidence.facts
          .map((f) => `[^F${f.factId}^] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`)
          .join('\n')
      : '（无已确认事实）';

  const chunksText =
    evidence.chunks.length > 0
      ? evidence.chunks
          .map((c) => `[^${c.chunkId}^] ${c.entryTitle}\n${c.chunkText.slice(0, 300)}`)
          .join('\n\n---\n\n')
      : '（无参考资料）';

  const userPrompt = `目标问题：${targetQuestion}

已确认事实：
${factsText}

参考资料：
${chunksText}

待审查 Claim：
${claimsText}

请输出 JSON：
{
  "passed": true|false,
  "score": 0-100,
  "unsupportedClaimIds": [1, 2],
  "riskWarnings": ["..."]
}`;

  const response = await chat(
    'claim_review',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  const validated = OutputSchema.parse(parsed);

  for (const claim of claims) {
    const isUnsupported = validated.unsupportedClaimIds.includes(claim.id);
    updateClaimReviewStatus(
      claim.id,
      isUnsupported ? 'flagged' : 'verified',
    );
  }

  updateArticleStatus(artifactId, 'claim_reviewed');

  const review = createReview({
    artifactId,
    projectId: artifact.project_id,
    reviewType: 'claim',
    reviewer: 'deepseek',
    passed: validated.passed,
    score: validated.score,
    reviewJson: validated,
    riskWarnings: validated.riskWarnings,
  });

  return {
    reviewId: review.id,
    passed: validated.passed,
    score: validated.score,
    unsupportedClaimIds: validated.unsupportedClaimIds,
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
