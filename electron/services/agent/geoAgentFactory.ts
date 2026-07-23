import {tool} from '@langchain/core/tools';
import {createDeepAgent} from 'deepagents';
import {z} from 'zod';
import type {DeepAgent} from 'deepagents';
import {createAgentModel} from './geoAgentModel.ts';
import {searchSimilarChunks} from '../vectorStore.ts';
import {askQuestion} from '../ragService.ts';
import {embedText} from '../embedding.ts';
import {getDb} from '../../db/connection.ts';
import {buildSystemPrompt, getFactTypesForDomain} from './geoAgentSystemPrompt.ts';
import {loadPrompt} from '../../prompts/loader.ts';
import {executeWithGuard, type GuardedToolCallOptions} from './toolGuard.ts';
import {generateQuestions} from '../article/questionPoolService.ts';
import {discoverSources} from '../article/sourceDiscoveryService.ts';
import {generateArticle} from '../article/articleGenerationService.ts';
import {reviewClaims} from '../article/claimReviewService.ts';
import {reviewGeo} from '../article/geoReviewService.ts';
import {extractFacts} from '../facts/factExtractionService.ts';
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
 * Context threaded through every Phase-7 tool executor so the toolGuard can
 * audit the call, transition the owning task to `waiting_approval` for
 * high-risk skills, and push `approval_request` MessageParts for medium/low.
 *
 * `taskId` / `messageId` are optional because the global (no-project) agent
 * path and some callers don't have them yet; the guard degrades gracefully.
 */
export interface AgentToolContext {
  taskId?: number | null;
  messageId?: number | null;
  /** Resolves a high-risk approval row when the user responds in the UI. */
  waitForApproval?: (approvalId: number) => Promise<boolean>;
}

/**
 * Runs a tool executor body under the toolGuard policy. Every Phase-7 tool
 * goes through this so the guard's risk gating, ledger audit, and
 * approval-request MessagePart side effects actually fire.
 *
 * The guard returns a structured result; for LangChain tools we unwrap a
 * successful `completed` result and re-throw on `failed`/`rejected` so the
 * agent sees the error. `toolName` is the dotted skill identifier used for
 * ledger audit and risk lookup (matches the issue's naming).
 */
async function runGuarded<T>(
  toolName: string,
  input: unknown,
  projectId: number | undefined,
  ctx: AgentToolContext,
  thunk: () => Promise<T>,
): Promise<T> {
  const options: GuardedToolCallOptions = {
    skillName: toolName,
    args: (input ?? {}) as Record<string, unknown>,
    taskId: ctx.taskId ?? null,
    projectId: projectId ?? null,
    messageId: ctx.messageId ?? null,
    waitForApproval: ctx.waitForApproval,
  };

  const guarded = await executeWithGuard<T>(options, thunk);

  if (guarded.status === 'completed') {
    return guarded.result as T;
  }
  if (guarded.status === 'failed') {
    throw new Error(guarded.error ?? `${toolName} failed`);
  }
  // rejected (user declined a high-risk call) — surface as an error so the
  // agent stops the current chain.
  throw new Error(`${toolName} was rejected by the user`);
}

// ── Skill executors (shared by createGeoAgent tools and the runtime) ─────────
//
// Each executor is the body that used to live inline inside the LangChain
// `tool(...)` wrappers below. They are extracted here so that BOTH the
// `createGeoAgent` tool registration path AND the new Agent-first Runtime
// (geoAgentRuntime.ts) invoke the exact same implementation under the
// toolGuard policy. A runtime that routes to a skill name can look the
// executor up in `SKILL_EXECUTORS` instead of re-implementing the call.
//
// Every executor returns a JSON string (the same contract the LangChain tools
// used) so callers don't have to care which path produced the result.

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
  ctx: AgentToolContext,
) => Promise<string>;

async function executeQuestionGenerate(
  args: SkillExecutorArgs,
  ctx: AgentToolContext,
): Promise<string> {
  return runGuarded('question.generate', args, args.projectId, ctx, async () => {
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
  });
}

async function executeSourceDiscover(
  args: SkillExecutorArgs,
  ctx: AgentToolContext,
): Promise<string> {
  return runGuarded('source.discover', args, args.projectId, ctx, async () => {
    const sources = await discoverSources(args.projectId!, args.targetQuestion!);
    return JSON.stringify(sources, null, 2);
  });
}

async function executeArticleGenerate(
  args: SkillExecutorArgs,
  ctx: AgentToolContext,
): Promise<string> {
  return runGuarded('article.generate', args, args.projectId, ctx, async () => {
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
  });
}

async function executeFactExtract(
  args: SkillExecutorArgs,
  ctx: AgentToolContext,
): Promise<string> {
  return runGuarded('fact.extract', args, args.projectId, ctx, async () => {
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
  });
}

async function executeClaimReview(
  args: SkillExecutorArgs,
  ctx: AgentToolContext,
): Promise<string> {
  return runGuarded('claim.review', args, undefined, ctx, async () => {
    const result = await reviewClaims(args.artifactId!);
    return JSON.stringify(result, null, 2);
  });
}

async function executeGeoReview(
  args: SkillExecutorArgs,
  ctx: AgentToolContext,
): Promise<string> {
  return runGuarded('geo.review', args, undefined, ctx, async () => {
    const result = await reviewGeo(args.artifactId!);
    return JSON.stringify(result, null, 2);
  });
}

/**
 * `publish.plan` is the contractually high-risk skill (T8). There is no
 * backing service yet, so the executor is a no-op that returns a pause
 * marker. The toolGuard still writes a `tool_approvals` row and transitions
 * the owning task to `waiting_approval` before this body runs, so the runtime
 * observes `{status:'waiting_approval'}` and pauses — which is exactly the
 * acceptance criterion "publish.plan 被触发时，runtime 暂停并推审批卡片".
 */
async function executePublishPlan(
  _args: SkillExecutorArgs,
  _ctx: AgentToolContext,
): Promise<string> {
  return JSON.stringify({status: 'waiting_for_approval', message: '发布计划已生成，等待用户审批'});
}

/**
 * Registry of dotted skill identifiers → executor. Used by:
 *   - the Agent-first Runtime (geoAgentRuntime.ts) after intentRouter picks a skill
 *   - future callers that want to invoke a skill directly
 *
 * The LangChain `tool(...)` wrappers in `createGeoAgent` below call these same
 * functions so behaviour is identical regardless of entry point.
 */
export const SKILL_EXECUTORS: Record<string, SkillExecutor> = {
  'question.generate': executeQuestionGenerate,
  'source.discover': executeSourceDiscover,
  'article.generate': executeArticleGenerate,
  'fact.extract': executeFactExtract,
  'claim.review': executeClaimReview,
  'geo.review': executeGeoReview,
  'publish.plan': executePublishPlan,
};

// ── Factory ─────────────────────────────────────────────────────────────────

export function createGeoAgent(projectId?: number, toolCtx: AgentToolContext = {}): DeepAgent {
  const model = createAgentModel();
  const project = projectId ? getProjectRow(projectId) : null;

  const answerUserTool = tool(
    async (input) => {
      if (input.projectId) {
        const answer = await askQuestion(input.projectId, input.query, 5);
        return answer.answer;
      }

      // 无项目时基于通用知识直接回答
      const response = await model.invoke([
        {
          role: 'system',
          content: `${loadPrompt('soul')}\n\n当前未选择项目。请基于通用知识回答用户问题，不要引用具体企业知识库。回答简洁专业。`,
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

  const projectListTool = tool(
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

  const projectCreateTool = tool(
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

  const tools: any[] = [answerUserTool, projectListTool, projectCreateTool];

  if (projectId) {
    const kbSearchTool = tool(
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
    tools.push(kbSearchTool);

    // ── Phase 7 service wrappers (T9) ─────────────────────────────────────

    const questionGenerateTool = tool(
      async (input) => executeQuestionGenerate(input, toolCtx),
      {
        name: 'question_generate',
        description:
          '基于企业已确认事实，生成 5-10 个用户最可能向 AI 提问的目标问题，含商业价值评分。',
        schema: questionGenerateInputSchema,
      },
    );
    tools.push(questionGenerateTool);

    const sourceDiscoverTool = tool(
      async (input) => executeSourceDiscover(input, toolCtx),
      {
        name: 'source_discover',
        description: '为目标问题推荐权威参考信源（行业报告、榜单、协会等）。',
        schema: sourceDiscoverInputSchema,
      },
    );
    tools.push(sourceDiscoverTool);

    const articleGenerateTool = tool(
      async (input) => executeArticleGenerate(input, toolCtx),
      {
        name: 'article_generate',
        description:
          '基于企业已确认事实生成 GEO 文章（支持类或排行榜类）。会创建 artifact 并抽取 claim 列表。',
        schema: articleGenerateInputSchema,
      },
    );
    tools.push(articleGenerateTool);

    const factExtractTool = tool(
      async (input) => executeFactExtract(input, toolCtx),
      {
        name: 'fact_extract',
        description:
          '从知识库 chunks 中抽取企业事实（写入 candidate facts，等待人工 review）。会根据项目 domain 选择对应的 ontology schema。',
        schema: factExtractInputSchema,
      },
    );
    tools.push(factExtractTool);

    const claimReviewTool = tool(
      async (input) => executeClaimReview(input, toolCtx),
      {
        name: 'claim_review',
        description: '审核文章中的 Claim（断言）是否有足够的事实支持，输出通过/未通过与风险预警。',
        schema: claimReviewInputSchema,
      },
    );
    tools.push(claimReviewTool);

    const geoReviewTool = tool(
      async (input) => executeGeoReview(input, toolCtx),
      {
        name: 'geo_review',
        description: '审核文章的 GEO 优化质量（结构、可引用性、Schema 等），输出评分与改进建议。',
        schema: geoReviewInputSchema,
      },
    );
    tools.push(geoReviewTool);
  }

  const systemPrompt = buildSystemPrompt({
    projectId,
    projectName: project?.name,
    projectDomain: project?.domain ?? null,
  });

  return createDeepAgent({
    name: projectId ? 'geo-project-agent' : 'geo-global-agent',
    model,
    tools,
    systemPrompt,
    checkpointer: false,
  });
}
