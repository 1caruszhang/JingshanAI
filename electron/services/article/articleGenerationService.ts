import {buildEvidencePack} from '../ragService.ts';
import {getProject} from '../projectService.ts';
import {generateSupportArticle} from '../../../skills/support-article-generation/index.ts';
import {
  createArticle,
  countConfirmedFacts,
  getClaimsByArtifactId,
  getArticleMetaByArtifactId,
  getArtifactById,
} from './articleRepository.ts';
import {parseClaims} from './claimParsingService.ts';
import type {ArticleStrategy, SupportArticleType} from './articleTypes.ts';
import type {AgentArtifact, ArticleArtifactMeta, ArticleClaim} from '@/types/domain';

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

  const skillOutput = await generateSupportArticle({
    projectName: project.name,
    supportArticleType,
    targetQuestion: input.targetQuestion,
    evidencePack: evidence,
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
