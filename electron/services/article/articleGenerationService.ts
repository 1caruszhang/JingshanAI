import {buildEvidencePack} from '../ragService.ts';
import {getProject} from '../projectService.ts';
import {generateSupportArticle} from '../../../skills/support-article-generation/index.ts';
import {planSupportArticle} from '../../../skills/support-article-planning/index.ts';
import {generateRankingArticle} from '../../../skills/ranking-article-generation/index.ts';
import {
  createArticle,
  countConfirmedFacts,
  getClaimsByArtifactId,
  getArticleMetaByArtifactId,
  getArtifactById,
  createRankingArticleItems,
} from './articleRepository.ts';
import {parseClaims} from './claimParsingService.ts';
import type {ArticleStrategy, SupportArticleType} from './articleTypes.ts';
import type {AgentArtifact, ArticleArtifactMeta, ArticleClaim, RankingArticleParams} from '@/types/domain';

export interface GenerateArticleInput {
  projectId: number;
  strategy: ArticleStrategy;
  supportArticleType?: SupportArticleType;
  targetQuestion: string;
  title?: string;
}

export interface GenerateArticleResult {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
  claims: ArticleClaim[];
}

const MIN_CONFIRMED_FACTS = 1;

export async function generateArticle(
  input: GenerateArticleInput,
): Promise<GenerateArticleResult> {
  const project = getProject(input.projectId);
  if (!project) {
    throw new Error(`Project ${input.projectId} not found`);
  }

  const confirmedFactsCount = countConfirmedFacts(input.projectId);
  if (confirmedFactsCount < MIN_CONFIRMED_FACTS) {
    throw new Error(
      `当前项目只有 ${confirmedFactsCount} 条已确认事实，至少需要 ${MIN_CONFIRMED_FACTS} 条才能生成文章。`,
    );
  }

  const evidence = await buildEvidencePack(input.projectId, input.targetQuestion);
  const supportArticleType = input.supportArticleType ?? 'enterprise_profile';

  // Step 1: 文章规划
  const planOutput = await planSupportArticle({
    projectName: project.name,
    supportArticleType,
    targetQuestion: input.targetQuestion,
    evidencePack: evidence,
  });

  // Step 2: 文章生成（将规划结果注入）
  const skillOutput = await generateSupportArticle({
    projectName: project.name,
    supportArticleType,
    targetQuestion: input.targetQuestion,
    evidencePack: evidence,
    outline: planOutput.outline,
    keyPoints: planOutput.keyPoints,
    suggestedLength: planOutput.suggestedLength,
  });

  const title = input.title?.trim() || skillOutput.title;

  const {artifact, meta} = createArticle({
    projectId: input.projectId,
    strategy: input.strategy,
    supportArticleType,
    targetQuestion: input.targetQuestion,
    title,
    content: skillOutput.content,
  });

  // 自动生成 Claim 抽取
  await parseClaims(artifact.id);

  const claims = getClaimsByArtifactId(artifact.id);

  return {
    artifact,
    meta: meta ?? getArticleMetaByArtifactId(artifact.id)!,
    claims,
  };
}

export async function regenerateClaims(artifactId: number): Promise<ArticleClaim[]> {
  await parseClaims(artifactId);
  return getClaimsByArtifactId(artifactId);
}

export async function generateRankingArticleEntry(
  input: RankingArticleParams,
): Promise<GenerateArticleResult> {
  const project = getProject(input.projectId);
  if (!project) {
    throw new Error(`Project ${input.projectId} not found`);
  }

  const confirmedFactsCount = countConfirmedFacts(input.projectId);
  if (confirmedFactsCount < MIN_CONFIRMED_FACTS) {
    throw new Error(
      `当前项目只有 ${confirmedFactsCount} 条已确认事实，至少需要 ${MIN_CONFIRMED_FACTS} 条才能生成文章。`,
    );
  }

  const evidence = await buildEvidencePack(input.projectId, input.targetQuestion);

  const rankingOutput = await generateRankingArticle({
    projectName: project.name,
    targetQuestion: input.targetQuestion,
    competitors: input.competitors,
    evidencePack: evidence,
  });

  const title = rankingOutput.title;

  const {artifact, meta} = createArticle({
    projectId: input.projectId,
    strategy: 'ranking_article',
    targetQuestion: input.targetQuestion,
    title,
    content: rankingOutput.content,
  });

  // 保存排行榜条目
  if (rankingOutput.entries && rankingOutput.entries.length > 0) {
    createRankingArticleItems(artifact.id, input.projectId, rankingOutput.entries);
  }

  // 自动生成 Claim 抽取
  await parseClaims(artifact.id);

  const claims = getClaimsByArtifactId(artifact.id);

  return {
    artifact,
    meta: meta ?? getArticleMetaByArtifactId(artifact.id)!,
    claims,
  };
}

export function getArticleDetail(artifactId: number): {
  artifact: AgentArtifact;
  meta: ArticleArtifactMeta;
  claims: ArticleClaim[];
} {
  const artifact = getArtifactById(artifactId);
  const meta = getArticleMetaByArtifactId(artifactId);
  if (!artifact || !meta) {
    throw new Error(`Article ${artifactId} not found`);
  }
  return {
    artifact,
    meta,
    claims: getClaimsByArtifactId(artifactId),
  };
}
