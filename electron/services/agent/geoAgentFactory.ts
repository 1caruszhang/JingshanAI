import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import type {createAgentModel} from './geoAgentModel.ts';
import {searchSimilarChunks} from '../vectorStore.ts';
import {askQuestion} from '../ragService.ts';
import {embedText} from '../embedding.ts';
import {getDb} from '../../db/connection.ts';
import {loadPrompt, loadSoulAndRule} from '../../prompts/loader.ts';
import {generateQuestions} from '../article/questionPoolService.ts';
import {discoverSources} from '../article/sourceDiscoveryService.ts';
import {generateArticle} from '../article/articleGenerationService.ts';
import {reviewClaims} from '../article/claimReviewService.ts';
import {reviewGeo} from '../article/geoReviewService.ts';
import {extractFacts} from '../facts/factExtractionService.ts';
import type {SkillDomain} from './skillRegistry.ts';
import type {Project} from '@/types/domain';

const answerUserInputSchema = z.object({
  query: z.string().min(1).describe('用户问题'),
  projectId: z.number().int().positive().optional().describe('若已选择项目则传入项目 ID，未选择时留空'),
});

const kbSearchInputSchema = z.object({
  projectId: z.number().int().positive().describe('知识库项目 ID'),
  query: z.string().min(1).describe('要检索的查询文本'),
  limit: z.number().int().min(1).max(20).optional().describe('返回结果数量，默认 5'),
});

const projectListInputSchema = z.object({});

const projectCreateInputSchema = z.object({
  name: z.string().min(1).describe('项目名称，通常为企业名称'),
  description: z.string().optional().describe('项目描述'),
  industry: z.string().optional().describe('所属行业'),
  region: z.string().optional().describe('地区'),
});

const questionGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
});

const sourceDiscoverInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  targetQuestion: z.string().min(1).describe('目标问题（用户的真实提问）'),
});

const articleGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  strategy: z.enum(['support_article', 'ranking_article']).describe('文章策略'),
  targetQuestion: z.string().min(1).describe('目标问题'),
  supportArticleType: z
    .enum(['enterprise_profile', 'product_service_intro', 'industry_insight', 'case_study', 'solution_guide'])
    .optional()
    .describe('支持类文章子类型（strategy = support_article 时可用）'),
  title: z.string().optional().describe('可选文章标题'),
});

const factExtractInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  entryId: z.number().int().positive().optional().describe('可选：仅抽取指定 KB 条目'),
  chunkIds: z.array(z.number().int().positive()).optional().describe('可选：仅抽取指定 chunk IDs'),
});

const claimReviewInputSchema = z.object({
  artifactId: z.number().int().positive().describe('文章 artifact ID'),
});

const geoReviewInputSchema = z.object({
  artifactId: z.number().int().positive().describe('文章 artifact ID'),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getProjectRow(projectId: number): Project | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, name, description, industry, region, domain, status, created_at, updated_at FROM projects WHERE id = ?',
    )
    .get(projectId) as Project | undefined;
  return row ?? null;
}

/**
 * #81: Extracted from retired geoAgentSystemPrompt.ts.
 * Returns domain-specific fact type filters for fact extraction, or undefined
 * for default (all types).
 */
export function getFactTypesForDomain(domain: string | null | undefined): string[] | undefined {
  if (!domain) return undefined;
  switch (domain as SkillDomain) {
    case 'local_service':
      return [
        'full_name', 'short_name', 'detailed_address', 'service_area',
        'industry', 'products_services', 'target_customers',
        'core_advantages', 'trust_backing', 'customer_cases', 'contact',
      ];
    case 'saas':
      return [
        'full_name', 'short_name', 'industry', 'products_services',
        'related_brands', 'target_customers', 'core_advantages',
        'trust_backing', 'pain_points', 'customer_cases', 'contact',
      ];
    default:
      return undefined;
  }
}

// ── Skill executors (shared by subagents) ────────────────────────────────────
//
// #81: runGuarded + toolGuard 已退役，executor 直接调用底层 service。
// 安全审批通过 LangGraph interrupt (HITL) 实现，不再通过 toolGuard 的 risk gating。

export interface SkillExecutorArgs {
  projectId?: number;
  targetQuestion?: string;
  strategy?: 'support_article' | 'ranking_article';
  supportArticleType?:
    | 'enterprise_profile'
    | 'product_service_intro'
    | 'industry_insight'
    | 'case_study'
    | 'solution_guide';
  title?: string;
  artifactId?: number;
  entryId?: number;
  chunkIds?: number[];
}

export type SkillExecutor = (
  args: SkillExecutorArgs,
) => Promise<string>;

export async function executeQuestionGenerate(
  args: SkillExecutorArgs,
): Promise<string> {
  const items = await generateQuestions(args.projectId!);
  return JSON.stringify(
    items.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      score: q.score,
      scoreReason: q.scoreReason,
      status: q.status,
    })),
    null,
    2,
  );
}

export async function executeSourceDiscover(
  args: SkillExecutorArgs,
): Promise<string> {
  const sources = await discoverSources(args.projectId!, args.targetQuestion!);
  return JSON.stringify(sources, null, 2);
}

async function executeArticleGenerate(
  args: SkillExecutorArgs,
): Promise<string> {
  const result = await generateArticle({
    projectId: args.projectId!,
    strategy: args.strategy!,
    supportArticleType: args.supportArticleType,
    targetQuestion: args.targetQuestion!,
    title: args.title,
  });
  return JSON.stringify(
    {
      artifactId: result.artifact.id,
      title: result.artifact.title,
      status: result.artifact.status,
      claimsCount: result.claims.length,
    },
    null,
    2,
  );
}

export async function executeFactExtract(
  args: SkillExecutorArgs,
): Promise<string> {
  const proj = getProjectRow(args.projectId!);
  const relevantFactTypes = getFactTypesForDomain(proj?.domain ?? null);

  const result = await extractFacts({
    projectId: args.projectId!,
    entryId: args.entryId,
    chunkIds: args.chunkIds,
    factTypes: relevantFactTypes,
  });

  return JSON.stringify(
    {
      ...result,
      domain: proj?.domain ?? null,
      domainFactTypes: relevantFactTypes ?? 'all',
    },
    null,
    2,
  );
}

export async function executeClaimReview(
  args: SkillExecutorArgs,
): Promise<string> {
  const result = await reviewClaims(args.artifactId!);
  return JSON.stringify(result, null, 2);
}

export async function executeGeoReview(
  args: SkillExecutorArgs,
): Promise<string> {
  const result = await reviewGeo(args.artifactId!);
  return JSON.stringify(result, null, 2);
}

// ── Shared tool factories (reused by CEO runtime) ────────────────────────────

/**
 * `answer_user` 工具工厂。
 *
 * 双模式：
 * - 有 projectId → 基于项目知识库 RAG 回答（调用 `askQuestion`）
 * - 无 projectId → 基于通用知识直接回答（调模型 + qa.md prompt）
 */
export function createAnswerUserTool(model: ReturnType<typeof createAgentModel>) {
  return tool(
    async (input) => {
      if (input.projectId) {
        const answer = await askQuestion(input.projectId, input.query, 5);
        return answer.answer;
      }

      // 无项目时基于通用知识直接回答
      const response = await model.invoke([
        {
          role: 'system',
          content: `${loadSoulAndRule()}\n\n${loadPrompt('qa')}`,
        },
        {role: 'user', content: input.query},
      ]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    },
    {
      name: 'answer_user',
      description:
        '回答用户问题。如果已指定 projectId，则基于项目知识库回答；否则基于通用知识回答。',
      schema: answerUserInputSchema,
    },
  );
}

/** `project_list` 工具工厂 — 列出所有项目。 */
export function createProjectListTool() {
  return tool(
    async () => {
      const db = getDb();
      const rows = db
        .prepare(
          'SELECT id, name, description, industry, region, status, created_at, updated_at FROM projects ORDER BY updated_at DESC',
        )
        .all();
      return JSON.stringify(rows, null, 2);
    },
    {
      name: 'project_list',
      description: '列出所有已有项目，供用户选择或参考。',
      schema: projectListInputSchema,
    },
  );
}

/** `project_create` 工具工厂 — 创建新项目。 */
export function createProjectCreateTool() {
  return tool(
    async (input) => {
      const db = getDb();
      const result = db
        .prepare(
          "INSERT INTO projects (name, description, industry, region, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))",
        )
        .run(
          input.name,
          input.description ?? null,
          input.industry ?? null,
          input.region ?? null,
        );
      const newProjectId = Number(result.lastInsertRowid);
      return `已创建项目「${input.name}」，项目 ID 为 ${newProjectId}。创建完成后可以录入企业资料，然后基于知识库执行 GEO 任务。`;
    },
    {
      name: 'project_create',
      description: '创建一个新项目（企业），创建后可以继续录入知识库资料。',
      schema: projectCreateInputSchema,
    },
  );
}

/** `kb_search` 工具工厂 — 向量检索知识库。 */
export function createKbSearchTool() {
  return tool(
    async (input) => {
      const queryVector = await embedText(input.query);
      const results = await searchSimilarChunks(input.projectId, queryVector, input.limit ?? 5);
      return JSON.stringify(results, null, 2);
    },
    {
      name: 'kb_search',
      description: '在指定项目的知识库中进行向量检索，返回与查询最相关的资料片段。',
      schema: kbSearchInputSchema,
    },
  );
}

