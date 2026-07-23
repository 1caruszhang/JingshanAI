import {buildEvidencePack} from '../ragService.ts';
import {getProject} from '../projectService.ts';
import {generateSupportArticle} from '../../../skills/support-article-generation/index.ts';
import {planSupportArticle} from '../../../skills/support-article-planning/index.ts';
import {runMdDrivenSkill} from '../agent/mdDrivenRunner.ts';
import {
  createArticle,
  countConfirmedFacts,
  getClaimsByArtifactId,
  getArticleMetaByArtifactId,
  getArtifactById,
  createRankingArticleItems,
  updateArticleStatus,
  finalizeArticleAfterGeneration,
  saveSourceRecommendation,
} from './articleRepository.ts';
import {parseClaims} from './claimParsingService.ts';
import type {ArticleStrategy, SupportArticleType} from './articleTypes.ts';
import type {AgentArtifact, ArticleArtifactMeta, ArticleClaim, RankingArticleParams, SourceRecommendation} from '@/types/domain';

export interface GenerateArticleInput {
  projectId: number;
  strategy: ArticleStrategy;
  supportArticleType?: SupportArticleType;
  targetQuestion: string;
  title?: string;
  /**
   * Sources the user adopted in SourceDiscoveryView. Persisted to
   * article_artifacts_meta.source_recommendation so the draft detail view can
   * surface the reference sources the article was built against.
   */
  adoptedSources?: SourceRecommendation[];
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

  // 先创建占位记录，status = 'generating'
  const placeholder = createArticle({
    projectId: input.projectId,
    strategy: input.strategy,
    supportArticleType,
    targetQuestion: input.targetQuestion,
    title: input.title?.trim() || '生成中...',
    content: '',
    status: 'generating',
  });
  const artifactId = placeholder.artifact.id;

  try {
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

    // 更新内容和标题，status = 'draft'
    finalizeArticleAfterGeneration(artifactId, title, skillOutput.content);

    // 持久化采用的信源到 article_artifacts_meta.source_recommendation
    if (input.adoptedSources && input.adoptedSources.length > 0) {
      saveSourceRecommendation(artifactId, JSON.stringify(input.adoptedSources));
    }

    // 自动生成 Claim 抽取
    await parseClaims(artifactId);

    const claims = getClaimsByArtifactId(artifactId);
    const finalArtifact = getArtifactById(artifactId)!;
    const finalMeta = getArticleMetaByArtifactId(artifactId)!;

    return {artifact: finalArtifact, meta: finalMeta, claims};
  } catch (err) {
    // 生成失败：更新 status = 'failed'
    try {
      updateArticleStatus(artifactId, 'failed');
    } catch {
      // ignore secondary failure
    }
    throw err;
  }
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

  // md-driven 路径（#64 follow-up）：runMdDrivenSkill 走 tool_call 循环，
  // 由工具执行器自动完成 create_article_placeholder / finalize_article /
  // save_ranking_entries / parse_claims 副作用。这里通过自定义 executorContext
  // 捕获工具创建的 artifactId，以便结束后查回 artifact/meta/claims。
  let artifactId: number | null = null;
  const executorContext = {
    createArticle: (ai: Parameters<typeof createArticle>[0]) => {
      const result = createArticle(ai);
      artifactId = result.artifact.id;
      return result;
    },
    finalizeArticle: (id: number, title: string, content: string) =>
      finalizeArticleAfterGeneration(id, title, content),
    createRankingArticleItems: (id: number, projId: number, entries: unknown[]) =>
      createRankingArticleItems(id, projId, entries as Parameters<typeof createRankingArticleItems>[2]),
    parseClaims: (id: number) => parseClaims(id) as Promise<unknown[]>,
  };

  let result;
  try {
    result = await runMdDrivenSkill('ranking-article-generation', {
      projectId: input.projectId,
      taskArgs: {
        projectName: project.name,
        targetQuestion: input.targetQuestion,
        competitors: input.competitors,
        strategy: 'ranking_article',
      },
      userMessage: input.targetQuestion,
      executorContext,
    });
  } catch (err) {
    if (artifactId !== null) {
      try {
        updateArticleStatus(artifactId, 'failed');
      } catch {
        // ignore secondary failure
      }
    }
    throw err;
  }

  if (result.ok !== true) {
    if (artifactId !== null) {
      try {
        updateArticleStatus(artifactId, 'failed');
      } catch {
        // ignore secondary failure
      }
    }
    throw new Error(`排行榜文章生成失败：${result.errors.join('; ')}`);
  }

  if (artifactId === null) {
    throw new Error('排行榜文章生成完成但未创建 artifact（工具循环未触发 create_article_placeholder）');
  }

  const claims = getClaimsByArtifactId(artifactId);
  const finalArtifact = getArtifactById(artifactId)!;
  const finalMeta = getArticleMetaByArtifactId(artifactId)!;

  return {artifact: finalArtifact, meta: finalMeta, claims};
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
