/**
 * reviewAgent.ts
 *
 * ReviewAgent 子 agent 工厂（#85）。
 *
 * 创建 DeepAgents SubAgent spec，供 CEO DeepAgent 的 task 工具派发。
 * ReviewAgent 持有 5 个审核链工具，负责：
 * - claim_parsing：从已生成文章解析 Claim（断言）结构
 * - claim_source_mapping：为 Claim 从 Evidence Pack 找最相关来源 + 置信度
 * - geo_fact_check：核查事实性断言真伪，输出结构化核查报告 + 修正建议
 * - claim_review：Claim 真伪审核（supported/unsupported/needs_source）+ 评分
 * - geo_review：GEO 质量审核（引用就绪度评分 + 优化建议）
 *
 * interruptOn: {} —— 审核操作本身是安全门，不触发 HITL 中断。
 * 真正的高风险操作（发布）在 PublishAgent 的 interruptOn: {high_risk: true} 拦截。
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tool} from '@langchain/core/tools';
import type {StructuredTool} from '@langchain/core/tools';
import type {SubAgent} from 'deepagents';
import {z} from 'zod';
import {SystemMessage, HumanMessage} from '@langchain/core/messages';
import {loadSoulAndRule, stripFrontmatter} from '../../prompts/loader.ts';
import {createAgentModel} from './geoAgentModel.ts';
import {
  executeClaimReview,
  executeGeoReview,
  type SkillExecutorArgs,
} from './geoAgentFactory.ts';
import {parseClaims} from '../article/claimParsingService.ts';
import {buildEvidencePack} from '../ragService.ts';
import {getArtifactById, getClaimsByArtifactId} from '../article/articleRepository.ts';
import {mapClaimSources} from '../../../skills/claim-source-mapping/index.ts';

// ── 质量护栏 Zod schemas（导出供测试，不依赖 model/DB） ─────────────────────────

/**
 * claim_source_mapping 输出：MappedSource[]（最多 3 条）。
 * 复用 skills/claim-source-mapping/index.ts 的 MappedSourceSchema 语义。
 */
export const MappedSourceSchema = z.object({
  sourceType: z.enum(['fact', 'chunk']),
  sourceId: z.number().int().positive(),
  sourceQuote: z.string(),
  confidence: z.number().min(0).max(1),
});
export const ClaimSourceMappingOutputSchema = z.array(MappedSourceSchema).max(3);

/**
 * geo_fact_check 输出：结构化事实核查报告。
 * 字段对齐 skills/geo-fact-checker/SKILL.md 的输出约定。
 */
const FactCheckClaimSchema = z.object({
  id: z.string().min(1),
  originalClaim: z.string().min(1),
  claimType: z.enum([
    'numeric-statistic',
    'date',
    'ranking',
    'competitor-info',
    'quote',
    'general-fact',
  ]),
  status: z.enum([
    'verified',
    'partially_verified',
    'outdated',
    'contradicted',
    'uncertain',
  ]),
  evidenceSummary: z.string(),
  primarySource: z.string().optional(),
});
export const GeoFactCheckReportSchema = z.object({
  scope: z.string().min(1),
  claims: z.array(FactCheckClaimSchema),
  suggestedFixes: z.array(z.string()),
  risks: z.array(z.string()),
});

/**
 * 审核链最终汇总报告 envelope（issue #85 AC：Claim 真伪/置信度/来源匹配/修正建议/GEO 就绪度评分）。
 *
 * 这是 ReviewAgent 在审核链全部完成后向 CEO 汇总的报告契约。各工具自身的输出
 * 已在工具层校验（claim_source_mapping / geo_fact_check 用下方内联 schema；claim_parsing
 * / claim_review / geo_review 由其底层 service 的 OutputSchema.parse 校验）。本 envelope
 * 描述 ReviewAgent 汇总回复应包含的 5 个必备字段，供 CEO 消费时校验与 AGENT.md 输出约定对齐。
 */
export const ReviewReportEnvelopeSchema = z.object({
  claimVerdict: z.enum(['supported', 'needs_source', 'unsupported']),
  confidence: z.number().min(0).max(1),
  sourceMatches: z.array(
    z.object({
      claimText: z.string(),
      sourceType: z.enum(['fact', 'chunk']).optional(),
      sourceId: z.number().int().positive().optional(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  fixSuggestions: z.array(z.string()),
  geoReadinessScore: z.number().min(0).max(100),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 读取技能 SKILL.md body（去除 YAML frontmatter）。 */
function loadSkillBody(skillDir: string): string {
  const skillPath = join(process.cwd(), 'skills', skillDir, 'SKILL.md');
  const raw = readFileSync(skillPath, 'utf8');
  return stripFrontmatter(raw);
}

/** 安全 JSON parse，去除 markdown code fences。 */
function safeParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * 通用 LLM 调用辅助：用技能 SKILL.md 作为 system prompt，传入用户上下文，返回
 * JSON parse 后的对象。调用方负责 Zod 校验。
 */
async function callSkillLlm(args: {
  skillDir: string;
  systemPromptExtra?: string;
  userPrompt: string;
}): Promise<unknown> {
  const model = createAgentModel();
  const skillBody = loadSkillBody(args.skillDir);
  const systemText = args.systemPromptExtra
    ? `${args.systemPromptExtra}\n\n${skillBody}`
    : skillBody;

  const response = await model.invoke([
    new SystemMessage(systemText),
    new HumanMessage(args.userPrompt),
  ]);

  const text =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  return safeParseJson(text);
}

/**
 * Zod 校验辅助：成功返回 data，失败返回 JSON envelope error 字符串。
 * 调用方用 `typeof validated === 'string'` 区分失败 / 成功。
 */
function validateOrError<T>(
  parsed: unknown,
  schema: z.ZodType<T>,
): T | string {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return JSON.stringify({
      error: 'validation_failed',
      errors: result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    });
  }
  return result.data;
}

// ── Precondition helpers ─────────────────────────────────────────────────────

type PreconditionResult =
  | {ok: true; projectId?: number}
  | {ok: false; error: string; suggestion: string};

/** 确认 artifact 存在并返回其 project_id。 */
function checkArtifactExists(artifactId: number): PreconditionResult {
  const artifact = getArtifactById(artifactId);
  if (!artifact) {
    return {
      ok: false,
      error: 'precondition_failed',
      suggestion:
        '文章 artifact 不存在。请先由 ContentAgent 生成文章，再派发审核任务',
    };
  }
  return {ok: true, projectId: artifact.project_id};
}

/** 确认 artifact 已有 Claim（claim_review 前置）。 */
function checkClaimsExist(artifactId: number): PreconditionResult {
  const claims = getClaimsByArtifactId(artifactId);
  if (claims.length === 0) {
    return {
      ok: false,
      error: 'precondition_failed',
      suggestion:
        '该文章尚无 Claim。请先执行 claim_parsing 解析断言，再进行 claim_review',
    };
  }
  return {ok: true};
}

function formatPreconditionError(result: PreconditionResult): string {
  if (result.ok === false) {
    return JSON.stringify({
      error: result.error,
      reason: result.suggestion,
      suggestion: result.suggestion,
    });
  }
  return '';
}

// ── System prompt ────────────────────────────────────────────────────────────

function loadReviewSystemPrompt(): string {
  const soulAndRule = loadSoulAndRule();
  const agentPath = join(process.cwd(), 'agents', 'review', 'AGENT.md');
  const raw = readFileSync(agentPath, 'utf8');
  const body = stripFrontmatter(raw);
  return `${soulAndRule}\n\n${body}`;
}

// =============================================================================
//  Tool 1: claim_parsing（executor-wrap 模式，同 factAgent）
// =============================================================================

const claimParsingInputSchema = z.object({
  artifactId: z
    .number()
    .int()
    .positive()
    .describe('待审核文章的 artifact ID'),
});

function createClaimParsingTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkArtifactExists(input.artifactId);
      if (!pre.ok) return formatPreconditionError(pre);

      // 复用 claimParsingService.parseClaims：解析 + 来源映射 + 写入 claims 表
      const claims = await parseClaims(input.artifactId);

      return JSON.stringify({
        status: 'success',
        summary: `已从文章解析 ${claims.length} 条 Claim`,
        data: {
          claimsCount: claims.length,
          claims: claims.map((c) => ({
            claimText: c.claimText,
            claimType: c.claimType,
            riskLevel: c.riskLevel,
            sourcesCount: c.sources.length,
          })),
        },
      });
    },
    {
      name: 'claim_parsing',
      description: `从已生成文章中逐句提取 Claim（断言/结论），分类（fact/opinion/inference）并标注风险等级（low/medium/high），写入 claims 表。
审核链第一步。前置条件：文章 artifact 存在且已生成完成。
返回 {"status":"success","data":{"claimsCount":N,"claims":[...]}}。`,
      schema: claimParsingInputSchema,
    },
  );
}

// =============================================================================
//  Tool 2: claim_source_mapping（LLM-skill 模式，同 contentAgent）
// =============================================================================

const claimSourceMappingInputSchema = z.object({
  claimText: z.string().min(1).describe('需要溯源的 Claim 文本（断言字符串）'),
  projectId: z
    .number()
    .int()
    .positive()
    .describe('项目 ID，用于构建 Evidence Pack'),
});

function createClaimSourceMappingTool(): StructuredTool {
  return tool(
    async (input) => {
      // 构建 Evidence Pack（已确认事实 + 相关参考资料）
      const evidence = await buildEvidencePack(input.projectId, input.claimText);

      // 复用 skills/claim-source-mapping/index.ts 的 mapClaimSources（含 fallback）
      const mapped = await mapClaimSources({
        claimText: input.claimText,
        evidencePack: evidence,
      }).catch(() => []);

      // Zod 校验（质量护栏）
      const validated = validateOrError(mapped, ClaimSourceMappingOutputSchema);
      if (typeof validated === 'string') return validated;

      return JSON.stringify({
        status: 'success',
        summary: `为该 Claim 找到 ${validated.length} 条来源匹配`,
        data: {sources: validated},
      });
    },
    {
      name: 'claim_source_mapping',
      description: `为指定 Claim 从 Evidence Pack（已确认事实 + 参考资料）中找出最相关的来源（最多 3 条），给出置信度评分。
审核链第二步。前置条件：有 Claim 文本 + 项目有 Evidence Pack。
返回 {"status":"success","data":{"sources":[{sourceType,sourceId,sourceQuote,confidence}]}}。`,
      schema: claimSourceMappingInputSchema,
    },
  );
}

// =============================================================================
//  Tool 3: geo_fact_check（LLM-skill 模式，调用 geo-fact-checker SKILL.md）
// =============================================================================

const geoFactCheckInputSchema = z.object({
  artifactId: z
    .number()
    .int()
    .positive()
    .describe('待核查文章的 artifact ID'),
  content: z
    .string()
    .min(1)
    .describe('待核查的文章内容全文（Markdown 或纯文本）'),
  timeHorizon: z
    .string()
    .optional()
    .describe('可选：时间基准，如「截至 2026 年」'),
});

function createGeoFactCheckTool(): StructuredTool {
  return tool(
    async (input) => {
      // 用 geo-fact-checker SKILL.md 作为 system prompt 调用 LLM
      const userPrompt = `待核查内容：
${input.content}
${input.timeHorizon ? `\n时间基准：${input.timeHorizon}` : ''}

请按 SKILL.md 约定的四部分结构输出事实核查报告 JSON：
{
  "scope": "核查范围说明",
  "claims": [
    {"id":"C1","originalClaim":"...","claimType":"numeric-statistic|date|ranking|competitor-info|quote|general-fact","status":"verified|partially_verified|outdated|contradicted|uncertain","evidenceSummary":"...","primarySource":"域名+年份"}
  ],
  "suggestedFixes": ["..."],
  "risks": ["..."]
}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-fact-checker',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({
          error: 'llm_output_invalid',
          reason: 'LLM 未返回合法 JSON',
        });
      }

      // Zod 校验（质量护栏）
      const validated = validateOrError(parsed, GeoFactCheckReportSchema);
      if (typeof validated === 'string') return validated;

      return JSON.stringify({
        status: 'success',
        summary: `事实核查完成：${validated.claims.length} 条断言，${validated.suggestedFixes.length} 条修正建议`,
        data: validated,
      });
    },
    {
      name: 'geo_fact_check',
      description: `核查文章中的事实性断言（数字、日期、排名、竞品数据、引述统计），对照证据逐条验证真伪，输出结构化核查报告与修正建议。
审核链第三步。前置条件：有文章内容。
返回 {"status":"success","data":{"scope,claims,suggestedFixes,risks"}}。`,
      schema: geoFactCheckInputSchema,
    },
  );
}

// =============================================================================
//  Tool 4: claim_review（executor-wrap 模式，复用 executeClaimReview）
// =============================================================================

const claimReviewInputSchema = z.object({
  artifactId: z
    .number()
    .int()
    .positive()
    .describe('待审核文章的 artifact ID'),
});

function createClaimReviewTool(): StructuredTool {
  return tool(
    async (input) => {
      const existCheck = checkArtifactExists(input.artifactId);
      if (!existCheck.ok) return formatPreconditionError(existCheck);

      const claimsCheck = checkClaimsExist(input.artifactId);
      if (!claimsCheck.ok) return formatPreconditionError(claimsCheck);

      // 复用 geoAgentFactory.executeClaimReview → reviewClaims
      const result = await executeClaimReview({
        artifactId: input.artifactId,
      } satisfies SkillExecutorArgs);

      return result;
    },
    {
      name: 'claim_review',
      description: `对文章中的 Claim 进行真伪审核，对照企业事实/参考资料判定 supported/unsupported/needs_source，输出整体证据充分度评分（0-100）。
审核链第四步。前置条件：文章已有 Claim（先执行 claim_parsing）。
返回 claim review 结果（含 passed/score/unsupportedClaimIds/riskWarnings）。`,
      schema: claimReviewInputSchema,
    },
  );
}

// =============================================================================
//  Tool 5: geo_review（executor-wrap 模式，复用 executeGeoReview）
// =============================================================================

const geoReviewInputSchema = z.object({
  artifactId: z
    .number()
    .int()
    .positive()
    .describe('待审核文章的 artifact ID'),
});

function createGeoReviewTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkArtifactExists(input.artifactId);
      if (!pre.ok) return formatPreconditionError(pre);

      // 复用 geoAgentFactory.executeGeoReview → reviewGeo
      // reviewGeo 内部会读取前置 claim review 结论作为输入
      const result = await executeGeoReview({
        artifactId: input.artifactId,
      } satisfies SkillExecutorArgs);

      return result;
    },
    {
      name: 'geo_review',
      description: `对文章进行 GEO 质量审核，从关键信息前置/结构清晰/事实密度/可读性等维度评估被生成式引擎引用的就绪度，输出评分（0-100）+ 优化建议。
审核链第五步。建议先完成 claim_review（geo_review 会读取前置 claim review 结论）。
返回 geo review 结果（含 passed/score/suggestions/riskWarnings）。`,
      schema: geoReviewInputSchema,
    },
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * 创建 ReviewAgent SubAgent spec。
 *
 * 返回 DeepAgents SubAgent 配置，供 createDeepAgent({subagents: [...]}) 使用。
 * CEO 通过内置 task(subagent_type="review-agent", description="...") 工具派发。
 *
 * interruptOn: {} —— 审核操作本身是安全门，不触发 HITL 中断。
 */
export function createReviewAgent(): SubAgent {
  return {
    name: 'review-agent',
    description:
      'Claim 审核链 + GEO 质量审核子 agent。负责对已生成文章执行完整审核链：claim.parsing（解析断言）→ claim-source-mapping（来源映射）→ geo-fact-checker（事实核查）→ claim.review（Claim 真伪审核）→ geo.review（GEO 质量审核）。当用户要求"审核文章 Claim""事实核查""GEO 审核""review article"时使用此 agent。',
    systemPrompt: loadReviewSystemPrompt(),
    tools: [
      createClaimParsingTool(),
      createClaimSourceMappingTool(),
      createGeoFactCheckTool(),
      createClaimReviewTool(),
      createGeoReviewTool(),
    ],
    model: createAgentModel(),
    interruptOn: {},
  };
}
