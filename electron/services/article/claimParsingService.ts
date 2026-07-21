import {z} from 'zod';
import {chat} from '../llmService.ts';
import {buildEvidencePack} from '../ragService.ts';
import type {EvidencePack, EvidenceFact, EvidenceChunk} from '../ragService.ts';
import {
  getArtifactById,
  getArticleMetaByArtifactId,
  createClaims,
  getClaimsByArtifactId,
} from './articleRepository.ts';
import type {ParsedClaim, ClaimType, RiskLevel} from './articleTypes.ts';

const SYSTEM_PROMPT = `你是一名严谨的内容审核助手。你的任务是从一篇文章中逐句提取关键 Claim（断言/结论）。

要求：
1. 只提取文章中有实质信息量的断言、观点或推断。
2. 为每个 Claim 标注类型：
   - fact：可验证的事实性陈述（如数据、成立时间、产品功能）。
   - opinion：主观评价或观点。
   - inference：基于事实的推断或推论。
3. 为每个 Claim 标注风险等级：
   - low：明显基于已有事实，低风险。
   - medium：需要进一步核实或来源不够直接。
   - high：涉及数字、排名、对比等，若证据不足则风险高。
4. 不要拆分得过细；语义上紧密相关的一句话作为一个 Claim。
5. 以 JSON 数组格式输出，不要包含任何其他文本。`;

const OutputSchema = z.array(
  z.object({
    claimText: z.string().min(1),
    claimType: z.enum(['fact', 'opinion', 'inference']),
    riskLevel: z.enum(['low', 'medium', 'high']),
  }),
);

export async function parseClaims(artifactId: number): Promise<ParsedClaim[]> {
  const artifact = getArtifactById(artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found`);
  }

  const meta = getArticleMetaByArtifactId(artifactId);
  const targetQuestion = meta?.target_question ?? artifact.title ?? '';
  const evidence = await buildEvidencePack(artifact.project_id, targetQuestion);

  const userPrompt = `目标问题：${targetQuestion}

文章内容：
${artifact.content ?? ''}

请从以上文章中提取 Claim 列表，输出 JSON 数组：
[
  {"claimText": "...", "claimType": "fact|opinion|inference", "riskLevel": "low|medium|high"}
]`;

  const response = await chat(
    'claim_parsing',
    [
      {role: 'system', content: SYSTEM_PROMPT},
      {role: 'user', content: userPrompt},
    ],
    {responseFormat: 'json_object'},
  );

  const parsed = safeParseJson(response.content);
  if (!Array.isArray(parsed)) {
    throw new Error('Claim 抽取模型未返回 JSON 数组');
  }

  const validated = OutputSchema.parse(parsed);

  const parsedClaims: ParsedClaim[] = validated.map((c) => ({
    claimText: c.claimText,
    claimType: c.claimType as ClaimType,
    riskLevel: c.riskLevel as RiskLevel,
    sources: mapSources(c.claimText, evidence),
  }));

  createClaims(artifactId, artifact.project_id, parsedClaims);

  return getClaimsByArtifactId(artifactId).map((dbClaim) => ({
    claimText: dbClaim.claim_text,
    claimType: dbClaim.claim_type as ClaimType,
    riskLevel: dbClaim.risk_level as RiskLevel,
    sources: [],
  }));
}

function mapSources(
  claimText: string,
  evidence: EvidencePack,
): ParsedClaim['sources'] {
  const tokens = tokenize(claimText);
  if (tokens.length === 0) return [];

  const scored: Array<{
    sourceType: 'fact' | 'chunk';
    sourceId: number;
    sourceQuote: string;
    score: number;
  }> = [];

  for (const fact of evidence.facts) {
    const text = `${fact.factKey} ${fact.factValue ?? ''}`;
    const score = overlapScore(text, tokens);
    if (score >= 0.2) {
      scored.push({
        sourceType: 'fact',
        sourceId: fact.factId,
        sourceQuote: text.slice(0, 200),
        score,
      });
    }
  }

  for (const chunk of evidence.chunks) {
    const text = `${chunk.entryTitle} ${chunk.chunkText}`;
    const score = overlapScore(text, tokens);
    if (score >= 0.2) {
      scored.push({
        sourceType: 'chunk',
        sourceId: chunk.chunkId,
        sourceQuote: chunk.chunkText.slice(0, 200),
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);

  return top.map((s) => ({
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    sourceQuote: s.sourceQuote,
    confidence: Number(s.score.toFixed(2)),
  }));
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

function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
