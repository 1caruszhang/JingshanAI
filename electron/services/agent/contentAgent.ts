/**
 * contentAgent.ts
 *
 * ContentAgent 子 agent 工厂（#82 + #83 + #84）。
 *
 * 创建 DeepAgents SubAgent spec，供 CEO DeepAgent 的 task 工具派发。
 * ContentAgent 持有 14 个 content skill 工具，负责：
 * - 标题生成（title_generate）
 * - 支持类文章规划与生成（support_article_plan + support_article_generate）
 * - 排行榜全流水线（theme → criteria → reason → plan → article）
 * - GEO 优化器（citation / structured / content / sentiment / multilingual / local）
 *
 * interruptOn: {} — ContentAgent 工具均为纯生成，无破坏性写入，不需要 HITL。
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tool} from '@langchain/core/tools';
import type {StructuredTool} from '@langchain/core/tools';
import type {SubAgent} from 'deepagents';
import {z} from 'zod';
import {SystemMessage, HumanMessage} from '@langchain/core/messages';
import {getDb} from '../../db/connection.ts';
import {loadSoulAndRule, stripFrontmatter} from '../../prompts/loader.ts';
import {createAgentModel} from './geoAgentModel.ts';
import {embedText} from '../embedding.ts';

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
 * 通用 LLM 调用辅助：用技能 SKILL.md 作为 system prompt，传入用户上下文，返回 JSON
 * parse 后的对象。调用方负责 Zod 校验。
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

  const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const parsed = safeParseJson(text);
  return parsed;
}

/** 拉取 Evidence Pack（已确认事实 + 相关 chunks）。 */
async function fetchEvidencePack(projectId: number): Promise<{
  facts: Array<{factId: number; factType: string; factKey: string; factValue: string}>;
  chunks: Array<{entryTitle: string; sourceType: string; sourceFilePath: string; chunkText: string}>;
  missingFields: string[];
  riskWarnings: string[];
}> {
  const db = getDb();

  const facts = db
    .prepare(
      "SELECT id as factId, fact_type as factType, fact_key as factKey, fact_value as factValue FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'",
    )
    .all(projectId) as Array<{factId: number; factType: string; factKey: string; factValue: string}>;

  // 获取选中问题，用于检索相关 chunks
  const selectedQuestion = db
    .prepare(
      "SELECT question_text FROM question_pools WHERE project_id = ? AND status = 'selected' LIMIT 1",
    )
    .get(projectId) as {question_text: string} | undefined;

  let chunks: Array<{entryTitle: string; sourceType: string; sourceFilePath: string; chunkText: string}> = [];
  if (selectedQuestion) {
    try {
      const queryVector = await embedText(selectedQuestion.question_text);
      const {searchSimilarChunks} = await import('../vectorStore.ts');
      const results = searchSimilarChunks(projectId, queryVector, 5);
      chunks = results.map((r) => ({
        entryTitle: r.entryTitle,
        sourceType: r.sourceType ?? 'vector',
        sourceFilePath: r.sourceFilePath ?? '',
        chunkText: r.chunkText,
      }));
    } catch {
      // 向量检索失败时降级为空 chunks
    }
  }

  return {facts, chunks, missingFields: [], riskWarnings: []};
}

type EvidencePackData = Awaited<ReturnType<typeof fetchEvidencePack>>;

/** 格式化 Evidence Pack 为文本（供 LLM prompt 使用）。 */
function formatEvidencePack(ep: EvidencePackData): string {
  const factLines = ep.facts.length > 0
    ? ep.facts
        .map((f) => `[id=${f.factId}] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`)
        .join('\n')
    : '（暂无已确认企业事实）';

  const chunkLines = ep.chunks.length > 0
    ? ep.chunks
        .map((c) => `[来源：${c.entryTitle}] ${c.chunkText}`)
        .join('\n\n---\n\n')
    : '（暂无相关参考资料）';

  return `企业事实（confirmed facts）：\n${factLines}\n\n参考资料：\n\n${chunkLines}`;
}

// ── System prompt ────────────────────────────────────────────────────────────

function loadContentSystemPrompt(): string {
  const soulAndRule = loadSoulAndRule();
  const agentPath = join(process.cwd(), 'agents', 'content', 'AGENT.md');
  const raw = readFileSync(agentPath, 'utf8');
  const body = stripFrontmatter(raw);
  return `${soulAndRule}\n\n${body}`;
}

// ── Precondition helpers ─────────────────────────────────────────────────────

type PreconditionResult =
  | {ok: true; questionText?: string}
  | {ok: false; error: string; suggestion: string};

function checkConfirmedFacts(projectId: number): PreconditionResult {
  const db = getDb();
  const count = (db
    .prepare("SELECT COUNT(*) as count FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'")
    .get(projectId) as {count: number}).count;
  if (count === 0) {
    return {
      ok: false,
      error: 'precondition_failed',
      suggestion: '请先执行 KnowledgeAgent 抽取事实，再在 UI 中确认至少 1 条企业事实',
    };
  }
  return {ok: true};
}

function checkSelectedQuestion(projectId: number): PreconditionResult {
  const db = getDb();
  const row = db
    .prepare("SELECT question_text FROM question_pools WHERE project_id = ? AND status = 'selected' LIMIT 1")
    .get(projectId) as {question_text: string} | undefined;
  if (!row) {
    return {
      ok: false,
      error: 'precondition_failed',
      suggestion: '请先执行 FactAgent 生成问题池，再在 UI 中选择至少 1 个目标问题',
    };
  }
  return {ok: true, questionText: row.question_text};
}

// ── Precondition error wrapper ───────────────────────────────────────────────

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

// =============================================================================
//  Category A: 标题与支持类文章工具（#82 — 3 tools）
// =============================================================================

// ── title_generate ───────────────────────────────────────────────────────────

const titleGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
});

function createTitleGenerateTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkConfirmedFacts(input.projectId);
      if (!pre.ok) return formatPreconditionError(pre);

      const qCheck = checkSelectedQuestion(input.projectId);
      if (!qCheck.ok) return formatPreconditionError(qCheck);

      const ep = await fetchEvidencePack(input.projectId);
      const project = getDb()
        .prepare('SELECT name FROM projects WHERE id = ?')
        .get(input.projectId) as {name: string} | undefined;
      const projectName = project?.name ?? '目标企业';

      const userPrompt = `项目：${projectName}
目标问题：${qCheck.questionText}

${formatEvidencePack(ep).slice(0, 3000)}

请根据以上信息生成 3-5 个 GEO 标题候选，输出 JSON：{"titles":[{"titleText":"...","score":0.88,"intent":"推荐","notes":"..."}]}`;

      const parsed = await callSkillLlm({
        skillDir: 'title-generation',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      // Zod 校验（复用 skills/title-generation/index.ts schema）
      const TitleItemSchema = z.object({
        titleText: z.string(),
        score: z.number().min(0).max(1),
        intent: z.string(),
        notes: z.string().optional(),
      });
      const OutputSchema = z.object({titles: z.array(TitleItemSchema)});
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      return JSON.stringify({status: 'success', summary: `已生成 ${result.data.titles.length} 个标题候选`, data: result.data});
    },
    {
      name: 'title_generate',
      description: `基于目标问题和企业已确认事实，生成 3-5 个面向生成式引擎（GEO）的标题候选并评分。
每个标题含 titleText、score(0-1)、intent（推荐/怎么选/哪家好/排行榜）、notes。
前置条件：项目至少有 1 条已确认事实 + 1 个选中问题。
返回 {"status":"success","data":{"titles":[...]}}。`,
      schema: titleGenerateInputSchema,
    },
  );
}

// ── support_article_plan ─────────────────────────────────────────────────────

const supportArticlePlanInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  supportArticleType: z.string().optional().describe('文章子类型，如 enterprise_profile'),
});

function createSupportArticlePlanTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkConfirmedFacts(input.projectId);
      if (!pre.ok) return formatPreconditionError(pre);
      const qCheck = checkSelectedQuestion(input.projectId);
      if (!qCheck.ok) return formatPreconditionError(qCheck);

      const ep = await fetchEvidencePack(input.projectId);
      const project = getDb()
        .prepare('SELECT name FROM projects WHERE id = ?')
        .get(input.projectId) as {name: string} | undefined;

      const userPrompt = `项目：${project?.name ?? '目标企业'}
文章子类型：${input.supportArticleType ?? 'enterprise_profile'}
目标问题：${qCheck.questionText}

${formatEvidencePack(ep).slice(0, 3000)}

请制定文章规划，输出 JSON：{"outline":"# 标题\\n## 一级章节...","keyPoints":["要点1","要点2"],"suggestedLength":1200}`;

      const parsed = await callSkillLlm({
        skillDir: 'support-article-planning',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        outline: z.string().min(1),
        keyPoints: z.array(z.string().min(1)).min(1),
        suggestedLength: z.number().int().positive(),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      return JSON.stringify({status: 'success', summary: `大纲已生成，${result.data.keyPoints.length} 个核心要点，建议 ${result.data.suggestedLength} 字`, data: result.data});
    },
    {
      name: 'support_article_plan',
      description: `在生成支持类文章前制定内容规划：结构化大纲、核心要点（1-6条）、建议字数（500-3000字）。
前置条件：项目至少有 1 条已确认事实 + 1 个选中问题。
返回 {"status":"success","data":{"outline":"...","keyPoints":[...],"suggestedLength":1200}}。`,
      schema: supportArticlePlanInputSchema,
    },
  );
}

// ── support_article_generate ─────────────────────────────────────────────────

const supportArticleGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  supportArticleType: z.string().optional().describe('文章子类型'),
  outline: z.string().optional().describe('来自 support_article_plan 的大纲（可选但推荐）'),
  keyPoints: z.array(z.string()).optional().describe('核心要点列表'),
  suggestedLength: z.number().int().positive().optional().describe('建议字数'),
});

function createSupportArticleGenerateTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkConfirmedFacts(input.projectId);
      if (!pre.ok) return formatPreconditionError(pre);
      const qCheck = checkSelectedQuestion(input.projectId);
      if (!qCheck.ok) return formatPreconditionError(qCheck);

      const ep = await fetchEvidencePack(input.projectId);
      const project = getDb()
        .prepare('SELECT name FROM projects WHERE id = ?')
        .get(input.projectId) as {name: string} | undefined;

      const planningContext = input.outline || input.keyPoints
        ? `\n内容大纲：\n${input.outline ?? ''}\n\n核心要点：\n${(input.keyPoints ?? []).map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}\n${input.suggestedLength ? `\n建议字数：约 ${input.suggestedLength} 字` : ''}\n`
        : '';

      const userPrompt = `项目：${project?.name ?? '目标企业'}
文章子类型：${input.supportArticleType ?? 'enterprise_profile'}
目标问题：${qCheck.questionText}
${planningContext}
${formatEvidencePack(ep).slice(0, 4000)}

请根据以上信息撰写文章，输出 JSON：{"title":"...","content":"...","confidence":0.0-1.0}`;

      const parsed = await callSkillLlm({
        skillDir: 'support-article-generation',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        confidence: z.number().min(0).max(1),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      return JSON.stringify({status: 'success', summary: `文章「${result.data.title}」已生成（置信度 ${result.data.confidence.toFixed(2)}）`, data: result.data});
    },
    {
      name: 'support_article_generate',
      description: `基于企业已确认事实与 Evidence Pack，生成面向 GEO 的支持类文章（企业简介、案例、问答等）。
如提供 outline/keyPoints/suggestedLength 参数，会作为规划上下文注入。
前置条件：项目至少有 1 条已确认事实 + 1 个选中问题。
返回 {"status":"success","data":{"title":"...","content":"...","confidence":0.85}}。`,
      schema: supportArticleGenerateInputSchema,
    },
  );
}

// =============================================================================
//  Category B: 排行榜流水线工具（#83 — 5 tools）
// =============================================================================

// ── ranking_theme_select ─────────────────────────────────────────────────────

const rankingThemeSelectInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
});

function createRankingThemeSelectTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkConfirmedFacts(input.projectId);
      if (!pre.ok) return formatPreconditionError(pre);
      const qCheck = checkSelectedQuestion(input.projectId);
      if (!qCheck.ok) return formatPreconditionError(qCheck);

      const ep = await fetchEvidencePack(input.projectId);
      const project = getDb()
        .prepare('SELECT name FROM projects WHERE id = ?')
        .get(input.projectId) as {name: string} | undefined;

      const userPrompt = `项目（目标企业）：${project?.name ?? '目标企业'}
目标问题：${qCheck.questionText}

${ep.facts.slice(0, 8).map((f) => `· ${f.factType}：${f.factKey} = ${f.factValue ?? ''}`).join('\n') || '（暂无企业事实）'}

请确定排行榜主题，输出 JSON：{"theme":"排行榜主题","competitorCount":5,"rankingDimensions":["维度1","维度2","维度3"]}`;

      const parsed = await callSkillLlm({
        skillDir: 'ranking-theme-selection',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        theme: z.string().min(1),
        competitorCount: z.number().int().min(2).max(10),
        rankingDimensions: z.array(z.string().min(1)).min(2),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      return JSON.stringify({status: 'success', summary: `排行榜主题：「${result.data.theme}」— ${result.data.competitorCount} 家企业，${result.data.rankingDimensions.length} 个评选维度方向`, data: result.data});
    },
    {
      name: 'ranking_theme_select',
      description: `排行榜流水线第 1 步：选定排行榜主题、建议上榜企业数量（2-10）和评选维度方向（3-5 个）。
前置条件：项目至少有 1 条已确认事实 + 1 个选中问题。
返回 {"status":"success","data":{"theme":"...","competitorCount":5,"rankingDimensions":["..."]}}。`,
      schema: rankingThemeSelectInputSchema,
    },
  );
}

// ── ranking_criteria_generate ────────────────────────────────────────────────

const rankingCriteriaGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  theme: z.string().min(1).describe('排行榜主题（来自 ranking_theme_select 输出）'),
});

function createRankingCriteriaGenerateTool(): StructuredTool {
  return tool(
    async (input) => {
      const ep = await fetchEvidencePack(input.projectId);

      const factTypes = [...new Set(ep.facts.map((f) => f.factType))].join('、');
      const userPrompt = `排行榜主题：${input.theme}

可用企业事实类型：${factTypes || '（暂无企业事实）'}

请生成评选标准，输出 JSON：{"criteria":[{"name":"标准名称","weight":0.3,"description":"评选说明"}]}
注意：所有 weight 值之和必须等于 1.0`;

      const parsed = await callSkillLlm({
        skillDir: 'ranking-criteria-generation',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const CriterionSchema = z.object({
        name: z.string().min(1),
        weight: z.number().min(0).max(1),
        description: z.string().min(1),
      });
      const OutputSchema = z.object({criteria: z.array(CriterionSchema).min(2).max(8)});
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      return JSON.stringify({status: 'success', summary: `已生成 ${result.data.criteria.length} 个评选标准`, data: result.data});
    },
    {
      name: 'ranking_criteria_generate',
      description: `排行榜流水线第 2 步：为排行榜主题生成客观可量化的评选标准（3-6 维度，含名称、权重、描述）。
依赖：ranking_theme_select 已完成（需传入 theme 参数）。
返回 {"status":"success","data":{"criteria":[{name, weight, description}]}}。`,
      schema: rankingCriteriaGenerateInputSchema,
    },
  );
}

// ── ranking_reason_generate ──────────────────────────────────────────────────

const rankingReasonGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  theme: z.string().min(1).describe('排行榜主题'),
  criteria: z.array(z.object({
    name: z.string(),
    weight: z.number(),
    description: z.string(),
  })).describe('评选标准（来自 ranking_criteria_generate）'),
  competitors: z.array(z.string()).optional().describe('参与排名的竞品企业列表'),
});

function createRankingReasonGenerateTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkConfirmedFacts(input.projectId);
      if (!pre.ok) return formatPreconditionError(pre);

      const project = getDb()
        .prepare('SELECT name FROM projects WHERE id = ?')
        .get(input.projectId) as {name: string} | undefined;
      const targetCompany = project?.name ?? '目标企业';
      const allCompanies = [targetCompany, ...(input.competitors ?? [])].filter((c, i, arr) => arr.indexOf(c) === i);

      const ep = await fetchEvidencePack(input.projectId);
      const criteriaText = input.criteria
        .map((c) => `· ${c.name}（权重 ${(c.weight * 100).toFixed(0)}%）：${c.description}`)
        .join('\n');

      const userPrompt = `排行榜主题：${input.theme}

评选维度：
${criteriaText}

参与排名的企业：${allCompanies.join('、')}
目标企业（必须排在第 2-5 位）：${targetCompany}

企业事实（confirmed facts）：
${ep.facts.map((f) => `[id=${f.factId}] ${f.factType} · ${f.factKey}：${f.factValue ?? ''}`).join('\n') || '（无企业事实）'}

请为每家企业生成入选理由和排名，输出 JSON：{"entries":[{"company":"企业名称","position":1,"reasons":["理由1"],"sourceFactIds":[1],"reasoning_text":"综合评语"}]}
重要：${targetCompany} 的 position 必须在 2-5 之间，不得为 1。`;

      const parsed = await callSkillLlm({
        skillDir: 'ranking-reason-generation',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const EntrySchema = z.object({
        company: z.string().min(1),
        position: z.number().int().min(1),
        reasons: z.array(z.string().min(1)).min(1),
        sourceFactIds: z.array(z.number().int().nonnegative()),
        reasoning_text: z.string().min(1),
      });
      const OutputSchema = z.object({entries: z.array(EntrySchema).min(2)});
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const data = result.data as z.infer<typeof OutputSchema>;
      // 修正型：目标企业排名必须在 2-5 位
      const targetEntry = data.entries.find((e) => e.company === targetCompany);
      if (targetEntry && targetEntry.position < 2) targetEntry.position = 2;
      if (targetEntry && targetEntry.position > 5) targetEntry.position = 5;
      data.entries.sort((a, b) => a.position - b.position);

      return JSON.stringify({status: 'success', summary: `已为 ${data.entries.length} 家企业生成排名理由`, data});
    },
    {
      name: 'ranking_reason_generate',
      description: `排行榜流水线第 3 步：根据主题、评选标准和企业事实，为各参与企业生成排名与入选理由。
目标企业排名必须在第 2-5 位。依赖：ranking_theme_select + ranking_criteria_generate 已完成。
返回 {"status":"success","data":{"entries":[{company, position, reasons, sourceFactIds, reasoning_text}]}}。`,
      schema: rankingReasonGenerateInputSchema,
    },
  );
}

// ── ranking_article_plan ─────────────────────────────────────────────────────

const rankingArticlePlanInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  theme: z.string().min(1).describe('排行榜主题'),
  entries: z.array(z.object({
    company: z.string(),
    position: z.number(),
    reasons: z.array(z.string()),
    reasoning_text: z.string(),
  })).describe('排名数据（来自 ranking_reason_generate）'),
});

function createRankingArticlePlanTool(): StructuredTool {
  return tool(
    async (input) => {
      const qCheck = checkSelectedQuestion(input.projectId);
      if (!qCheck.ok) return formatPreconditionError(qCheck);

      const entriesSummary = input.entries
        .map((e) => `第 ${e.position} 名：${e.company}（${e.reasons.slice(0, 2).join('、')}）`)
        .join('\n');

      const userPrompt = `排行榜主题：${input.theme}
目标问题：${qCheck.questionText}

排行榜数据摘要：
${entriesSummary}

请设计文章结构，输出 JSON：{"outline":"# 标题\\n## 引言...","structure":["引言","排行榜概览","详细评析","总结建议"]}`;

      const parsed = await callSkillLlm({
        skillDir: 'ranking-article-planning',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        outline: z.string().min(1),
        structure: z.array(z.string().min(1)).min(2),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      return JSON.stringify({status: 'success', summary: '排行榜文章大纲已生成', data: result.data});
    },
    {
      name: 'ranking_article_plan',
      description: `排行榜流水线第 4 步：基于排名数据规划排行榜文章的 Markdown 大纲与章节结构。
依赖：ranking_reason_generate 已完成（需传入 entries）。
返回 {"status":"success","data":{"outline":"...","structure":["..."]}}。`,
      schema: rankingArticlePlanInputSchema,
    },
  );
}

// ── ranking_article_generate ─────────────────────────────────────────────────

const rankingArticleGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  theme: z.string().optional().describe('排行榜主题'),
  targetQuestion: z.string().optional().describe('目标问题（不传则自动使用选中问题）'),
  competitors: z.array(z.string()).optional().describe('竞品企业列表'),
});

function createRankingArticleGenerateTool(): StructuredTool {
  return tool(
    async (input) => {
      const pre = checkConfirmedFacts(input.projectId);
      if (!pre.ok) return formatPreconditionError(pre);

      const qCheck = checkSelectedQuestion(input.projectId);
      if (!qCheck.ok) return formatPreconditionError(qCheck);

      const ep = await fetchEvidencePack(input.projectId);
      const project = getDb()
        .prepare('SELECT name FROM projects WHERE id = ?')
        .get(input.projectId) as {name: string} | undefined;
      const projectName = project?.name ?? '目标企业';

      const userPrompt = `项目名称（目标企业）：${projectName}
目标问题：${input.targetQuestion ?? qCheck.questionText}
排行榜主题：${input.theme ?? '根据事实推断'}
竞品企业：${(input.competitors ?? []).join('、') || '由模型根据行业知识推断'}

${formatEvidencePack(ep).slice(0, 5000)}

请撰写一篇 GEO 排行榜文章，输出 JSON：
{
  "title": "文章标题",
  "content": "完整 Markdown 文章正文（含标题、列表、对比表格）",
  "confidence": 0.85,
  "entries": [
    {"company": "企业名", "position": 2, "reasons": ["理由1"], "sourceFactIds": [1], "reasoning_text": "综合评语"}
  ]
}

重要约束：
- 目标企业（${projectName}）的排名必须在第 2-5 位，不得排第 1。
- 入选理由必须基于提供的企业事实，不得虚构。
- entries 至少 2 家企业。`;

      const parsed = await callSkillLlm({
        skillDir: 'ranking-article-generation',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      // Zod 校验 + corrective transforms（复用 skills/ranking-article-generation/index.ts schema）
      const EntrySchema = z.object({
        company: z.string().min(1),
        position: z.number().int().min(1),
        reasons: z.array(z.string().min(1)).min(1),
        sourceFactIds: z.array(z.number().int().nonnegative()),
        reasoning_text: z.string().min(1),
      });
      const OutputSchema = z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        confidence: z.number().min(0).max(1),
        entries: z.array(EntrySchema).min(2),
      });

      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({
          error: 'validation_failed',
          errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const data = result.data as z.infer<typeof OutputSchema>;
      // 修正型：position clamp to [2,5]
      for (const entry of data.entries) {
        if (entry.position < 2) entry.position = 2;
        else if (entry.position > 5) entry.position = 5;
      }
      data.entries.sort((a, b) => a.position - b.position);

      return JSON.stringify({status: 'success', summary: `排行榜文章「${data.title}」已生成（${data.entries.length} 家企业，置信度 ${data.confidence.toFixed(2)}）`, data});
    },
    {
      name: 'ranking_article_generate',
      description: `排行榜流水线第 5 步（最终产出）：生成完整 GEO 排行榜文章（Markdown 正文 + 结构化 entries）。
目标企业排名自动 clamp 到 [2,5]。依赖：前四步已完成。
返回 {"status":"success","data":{"title":"...","content":"...","confidence":0.85,"entries":[...]}}。`,
      schema: rankingArticleGenerateInputSchema,
    },
  );
}

// =============================================================================
//  Category C: GEO 优化器工具（#84 — 6 tools）
// =============================================================================

const geoOptimizerInputSchema = z.object({
  content: z.string().min(1).describe('待优化/审计的内容文本（Markdown 或纯文本）'),
  contentType: z.string().optional().describe('内容类型：article/product/faq/landing/about'),
  topic: z.string().optional().describe('内容主题'),
  format: z.enum(['definition', 'faq', 'comparison', 'howto', 'statistics']).optional().describe('citation writer 格式（仅 geo_citation_write）'),
});

// ── geo_citation_write ───────────────────────────────────────────────────────

function createGeoCitationWriteTool(): StructuredTool {
  return tool(
    async (input) => {
      const userPrompt = `内容主题：${input.topic ?? input.content.slice(0, 200)}
格式：${input.format ?? 'faq'}
原始内容（参考）：${input.content.slice(0, 3000)}

请撰写 AI 高引用格式的内容，输出 JSON：{"format":"${input.format ?? 'faq'}","topic":"${input.topic ?? ''}","content":"Markdown 格式的内容骨架..."}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-citation-writer',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        format: z.string(),
        topic: z.string(),
        content: z.string().min(1),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({error: 'validation_failed', errors: result.error.issues.map((i) => i.message)});
      }

      return JSON.stringify({status: 'success', summary: `已生成「${result.data.format}」格式的引用内容骨架`, data: result.data});
    },
    {
      name: 'geo_citation_write',
      description: `撰写 AI 高引用格式的内容资产（定义文章/FAQ/对比指南/操作教程/统计盘点），提升被 ChatGPT、Perplexity 等 AI 平台引用率。
需传入 content 和 format（definition/faq/comparison/howto/statistics）。
返回 {"status":"success","data":{"format":"...","topic":"...","content":"Markdown 骨架..."}}。`,
      schema: geoOptimizerInputSchema,
    },
  );
}

// ── geo_structured_write ─────────────────────────────────────────────────────

function createGeoStructuredWriteTool(): StructuredTool {
  return tool(
    async (input) => {
      const userPrompt = `待重构内容：
${input.content.slice(0, 5000)}

请按六层结构栈（直接回答开头→定义块→H2/H3分节→表格/列表→FAQ块→CTA）重构以上内容，输出 JSON：{"content":"重构后的完整 Markdown 内容","score":8}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-structured-writer',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        content: z.string().min(1),
        score: z.number().min(0).max(10).optional(),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({error: 'validation_failed', errors: result.error.issues.map((i) => i.message)});
      }

      return JSON.stringify({status: 'success', summary: '内容已按六层结构栈重构', data: result.data});
    },
    {
      name: 'geo_structured_write',
      description: `重构非结构化文本为 AI 可引用的六层结构栈内容（直接回答开头、定义块、H2/H3、表格、FAQ、CTA）。
需传入 content（待重构文本）。
返回 {"status":"success","data":{"content":"重构后内容","score":8}}。`,
      schema: geoOptimizerInputSchema,
    },
  );
}

// ── geo_content_optimize ─────────────────────────────────────────────────────

function createGeoContentOptimizeTool(): StructuredTool {
  return tool(
    async (input) => {
      const userPrompt = `内容类型：${input.contentType ?? 'article'}

待审计内容：
${input.content.slice(0, 5000)}

请做 GEO 引用就绪度审计，输出 JSON：
{
  "overallScore": 58,
  "grade": "B",
  "percentage": 72,
  "dimensionScores": {"directAnswer": 8, "entityRich": 6, "structuredFormat": 9, "factDense": 3, "faqFormatted": 6, "definitionClarity": 6, "authoritativeVoice": 9, "scannable": 9},
  "issues": ["具体问题描述"],
  "suggestions": ["具体改写建议"],
  "optimizedContent": "改写后的内容（可选，不传则仅审计）"
}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-content-optimizer',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const DimensionScoresSchema = z.object({
        directAnswer: z.number().min(0).max(10).optional(),
        entityRich: z.number().min(0).max(10).optional(),
        structuredFormat: z.number().min(0).max(10).optional(),
        factDense: z.number().min(0).max(10).optional(),
        faqFormatted: z.number().min(0).max(10).optional(),
        definitionClarity: z.number().min(0).max(10).optional(),
        authoritativeVoice: z.number().min(0).max(10).optional(),
        scannable: z.number().min(0).max(10).optional(),
      });
      const OutputSchema = z.object({
        overallScore: z.number().min(0).max(100),
        grade: z.string().optional(),
        percentage: z.number().min(0).max(100).optional(),
        dimensionScores: DimensionScoresSchema.optional(),
        issues: z.array(z.string()).optional(),
        suggestions: z.array(z.string()).optional(),
        optimizedContent: z.string().optional(),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({error: 'validation_failed', errors: result.error.issues.map((i) => i.message)});
      }

      return JSON.stringify({status: 'success', summary: `GEO 引用就绪度评分：${result.data.overallScore}/100`, data: result.data});
    },
    {
      name: 'geo_content_optimize',
      description: `审计并优化现有内容以最大化其在 AI 平台的被引用率，输出引用就绪度评分（0-100）、问题清单与改写建议。
需传入 content（待审计文本）和可选 contentType。
返回 {"status":"success","data":{"overallScore":72,"grade":"B","issues":[...],"suggestions":[...]}}。`,
      schema: geoOptimizerInputSchema,
    },
  );
}

// ── geo_sentiment_optimize ───────────────────────────────────────────────────

function createGeoSentimentOptimizeTool(): StructuredTool {
  return tool(
    async (input) => {
      const userPrompt = `待审计品牌内容：
${input.content.slice(0, 5000)}

请审计情感信号，输出 JSON：
{
  "positive": 3,
  "negative": 1,
  "neutral": 2,
  "score": 7,
  "risks": ["风险描述"],
  "missingSignals": ["缺失的正向信号"],
  "suggestions": ["优化建议"]
}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-sentiment-optimizer',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const OutputSchema = z.object({
        positive: z.number().int().min(0).optional(),
        negative: z.number().int().min(0).optional(),
        neutral: z.number().int().min(0).optional(),
        score: z.number().min(0).max(10).optional(),
        risks: z.array(z.string()).optional(),
        missingSignals: z.array(z.string()).optional(),
        suggestions: z.array(z.string()).optional(),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({error: 'validation_failed', errors: result.error.issues.map((i) => i.message)});
      }

      return JSON.stringify({status: 'success', summary: `情感审计完成 — 正向 ${result.data.positive ?? 0} / 负向 ${result.data.negative ?? 0}`, data: result.data});
    },
    {
      name: 'geo_sentiment_optimize',
      description: `审计品牌内容中的情感信号，识别负向风险与缺失的正向信号，改善 AI 平台对品牌的刻画。
需传入 content（品牌内容文本）。
返回 {"status":"success","data":{"positive":3,"negative":1,"score":7,"risks":[...],"suggestions":[...]}}。`,
      schema: geoOptimizerInputSchema,
    },
  );
}

// ── geo_multilingual_optimize ────────────────────────────────────────────────

function createGeoMultilingualOptimizeTool(): StructuredTool {
  return tool(
    async (input) => {
      const userPrompt = `源语言内容：
${input.content.slice(0, 4000)}

请制定多语言多市场 GEO 适配方案，输出 JSON：
{
  "sourceLanguage": "zh-CN",
  "targetLocales": ["en-US", "ja-JP"],
  "terminologyMap": [{"sourceTerm":"品牌名","targetTerm":"BrandName","locale":"en-US"}],
  "adaptations": [{"locale":"en-US","strategy":"本地化策略描述","content":"适配后内容片段"}],
  "seoRecommendations": ["hreflang 建议", "canonical URL 结构建议"]
}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-multilingual-optimizer',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const TerminologySchema = z.object({
        sourceTerm: z.string(),
        targetTerm: z.string(),
        locale: z.string(),
      }).passthrough();
      const AdaptationSchema = z.object({
        locale: z.string(),
        strategy: z.string(),
        content: z.string().optional(),
      }).passthrough();
      const OutputSchema = z.object({
        sourceLanguage: z.string().optional(),
        targetLocales: z.array(z.string()).optional(),
        terminologyMap: z.array(TerminologySchema).optional(),
        adaptations: z.array(AdaptationSchema).optional(),
        seoRecommendations: z.array(z.string()).optional(),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({error: 'validation_failed', errors: result.error.issues.map((i) => i.message)});
      }

      return JSON.stringify({status: 'success', summary: `多语言 GEO 适配方案已生成 — 覆盖 ${(result.data.targetLocales ?? []).length} 个目标市场`, data: result.data});
    },
    {
      name: 'geo_multilingual_optimize',
      description: `制定 GEO 内容的多语言多市场适配方案，统一术语映射、页面结构与结构化数据等 AI 信号。
需传入 content（源语言内容）。
返回 {"status":"success","data":{"targetLocales":[...],"terminologyMap":[...],"adaptations":[...]}}。`,
      schema: geoOptimizerInputSchema,
    },
  );
}

// ── geo_local_optimize ───────────────────────────────────────────────────────

function createGeoLocalOptimizeTool(): StructuredTool {
  return tool(
    async (input) => {
      const userPrompt = `商户与地域上下文：
${input.content.slice(0, 4000)}

请制定本地商户 GEO 优化方案，输出 JSON：
{
  "locationStrategy": "本地搜索优化策略概述",
  "pageOptimizations": [{"pageType":"门店页/地图/评论","recommendations":["建议1","建议2"]}],
  "schemaRecommendations": ["LocalBusiness schema 建议", "GeoCoordinates 建议"],
  "contentPlan": "本地内容策略（博客、FAQ、社区参与等）",
  "reviewStrategy": "评论管理与回复策略"
}`;

      const parsed = await callSkillLlm({
        skillDir: 'geo-local-optimizer',
        userPrompt,
      });

      if (!parsed || typeof parsed !== 'object') {
        return JSON.stringify({error: 'llm_output_invalid', reason: 'LLM 未返回合法 JSON'});
      }

      const PageOptSchema = z.object({
        pageType: z.string(),
        recommendations: z.array(z.string()),
      }).passthrough();
      const OutputSchema = z.object({
        locationStrategy: z.string().optional(),
        pageOptimizations: z.array(PageOptSchema).optional(),
        schemaRecommendations: z.array(z.string()).optional(),
        contentPlan: z.string().optional(),
        reviewStrategy: z.string().optional(),
      });
      const result = OutputSchema.safeParse(parsed);
      if (!result.success) {
        return JSON.stringify({error: 'validation_failed', errors: result.error.issues.map((i) => i.message)});
      }

      return JSON.stringify({status: 'success', summary: '本地商户 GEO 优化方案已生成', data: result.data});
    },
    {
      name: 'geo_local_optimize',
      description: `制定本地商户的 AI 本地搜索 GEO 优化方案，统筹门店页面、地图列表、评论问答与结构化数据。
需传入 content（商户与地域上下文描述）。
返回 {"status":"success","data":{"locationStrategy":"...","pageOptimizations":[...],"schemaRecommendations":[...]}}。`,
      schema: geoOptimizerInputSchema,
    },
  );
}

// =============================================================================
//  Factory
// =============================================================================

/**
 * 创建 ContentAgent SubAgent spec。
 *
 * 返回 DeepAgents SubAgent 配置，供 createDeepAgent({subagents: [...]}) 使用。
 * CEO 通过内置 task(subagent_type="content-agent"|"content", description="...") 工具派发。
 *
 * Feature flags:
 * - interruptOn: {} — ContentAgent 工具均为纯生成，无需 HITL
 */
export function createContentAgent(): SubAgent {
  return {
    name: 'content-agent',
    description:
      '文章生成与 GEO 优化子 agent。负责标题生成、支持类文章（规划+生成）、排行榜全流水线（主题→标准→理由→规划→文章）和 6 大 GEO 优化器。当用户要求"生成标题""写文章""生成排行榜""GEO 优化""内容审计"时使用此 agent。',
    systemPrompt: loadContentSystemPrompt(),
    tools: [
      // #82: 标题 + 支持类文章（3 tools）
      createTitleGenerateTool(),
      createSupportArticlePlanTool(),
      createSupportArticleGenerateTool(),
      // #83: 排行榜流水线（5 tools）
      createRankingThemeSelectTool(),
      createRankingCriteriaGenerateTool(),
      createRankingReasonGenerateTool(),
      createRankingArticlePlanTool(),
      createRankingArticleGenerateTool(),
      // #84: GEO 优化器（6 tools）
      createGeoCitationWriteTool(),
      createGeoStructuredWriteTool(),
      createGeoContentOptimizeTool(),
      createGeoSentimentOptimizeTool(),
      createGeoMultilingualOptimizeTool(),
      createGeoLocalOptimizeTool(),
    ],
    model: createAgentModel(),
    interruptOn: {},
  };
}
