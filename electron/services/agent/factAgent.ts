/**
 * factAgent.ts
 *
 * FactAgent 子 agent 工厂（#80）。
 *
 * 创建 DeepAgents SubAgent spec，供 CEO DeepAgent 的 task 工具派发。
 * FactAgent 持有 question_generate 和 source_discover 工具，负责：
 * - 基于已确认企业事实生成目标问题池
 * - 为目标问题发现权威参考信源
 *
 * interruptOn:
 *   question_generate: true — #79 HITL bridge PoC：
 *     question_generate 执行前触发 interrupt，等待用户在 UI 审批。
 *   source_discover: true — #79 HITL bridge PoC：
 *     source_discover 执行前触发 interrupt，等待用户在 UI 审批。
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tool} from '@langchain/core/tools';
import type {StructuredTool} from '@langchain/core/tools';
import type {SubAgent} from 'deepagents';
import {z} from 'zod';
import {getDb} from '../../db/connection.ts';
import {loadSoulAndRule, stripFrontmatter} from '../../prompts/loader.ts';
import {createAgentModel} from './geoAgentModel.ts';
import {
  executeQuestionGenerate,
  executeSourceDiscover,
  type SkillExecutorArgs,
} from './geoAgentFactory.ts';

// ── System prompt ────────────────────────────────────────────────────────────────

function loadFactSystemPrompt(): string {
  const soulAndRule = loadSoulAndRule();
  const agentPath = join(process.cwd(), 'agents', 'fact', 'AGENT.md');
  const raw = readFileSync(agentPath, 'utf8');
  const body = stripFrontmatter(raw);
  return `${soulAndRule}\n\n${body}`;
}

// ── question_generate tool (LangChain wrapper) ────────────────────────────────────

const questionGenerateInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
});

/**
 * FactAgent 专用的 question_generate LangChain 工具。
 *
 * 包装现有的 `executeQuestionGenerate` 执行体，增加：
 * - 前置条件检查：无已确认事实时返回明确错误（非静默失败）
 * - 作为 SubAgent 工具（不含 toolGuard，interrupt 由 interruptOn 控制）
 */
function createQuestionGenerateTool(): StructuredTool {
  return tool(
    async (input) => {
      // 前置条件门：检查是否存在已确认事实
      const db = getDb();
      const confirmedCount = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'",
          )
          .get(input.projectId) as {count: number}
      ).count;

      if (confirmedCount === 0) {
        return JSON.stringify({
          error: 'precondition_failed',
          reason:
            '该项目尚无已确认的企业事实。请先确认至少 1 条企业事实（在「事实管理」页面审核 candidate facts），然后才能生成问题池。',
          suggestion: '先执行 KnowledgeAgent 抽取事实，再在 UI 中确认事实',
          questionsGenerated: 0,
        });
      }

      // 调用现有的问题生成执行体（复用 geoAgentFactory.ts 的核心逻辑）
      const result = await executeQuestionGenerate(
        {
          projectId: input.projectId,
        } satisfies SkillExecutorArgs,
      );

      return result;
    },
    {
      name: 'question_generate',
      description: `基于企业已确认事实，生成 5–10 个用户最可能向 AI 提问的目标问题（含商业价值评分）。
问题会写入 question_pools 表（status=candidate），供后续人工筛选（select/reject）。
前置条件：项目必须至少有 1 条已确认事实（enterprise_facts status=confirmed），否则返回明确错误。
返回 [{id, questionText, score, scoreReason, status}] 数组。`,
      schema: questionGenerateInputSchema,
    },
  );
}

// ── source_discover tool (LangChain wrapper) ──────────────────────────────────────

const sourceDiscoverInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  targetQuestion: z.string().min(1).describe('目标问题（用户的真实提问）'),
});

/**
 * FactAgent 专用的 source_discover LangChain 工具。
 *
 * 包装现有的 `executeSourceDiscover` 执行体，增加：
 * - 前置条件检查：无选中问题时返回明确错误（非静默失败）
 * - 作为 SubAgent 工具（不含 toolGuard，interrupt 由 interruptOn 控制）
 */
function createSourceDiscoverTool(): StructuredTool {
  return tool(
    async (input) => {
      // 前置条件门：检查是否有选中的目标问题
      const db = getDb();
      const selectedCount = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM question_pools WHERE project_id = ? AND status = 'selected'",
          )
          .get(input.projectId) as {count: number}
      ).count;

      if (selectedCount === 0) {
        return JSON.stringify({
          error: 'precondition_failed',
          reason:
            '该项目尚无选中的目标问题。请先生成问题池并在「问题管理」页面选择至少 1 个目标问题，然后才能发现信源。',
          suggestion: '先执行 question_generate 生成问题池，再在 UI 中选择目标问题',
          sourcesFound: 0,
        });
      }

      // 调用现有的信源发现执行体（复用 geoAgentFactory.ts 的核心逻辑）
      const result = await executeSourceDiscover(
        {
          projectId: input.projectId,
          targetQuestion: input.targetQuestion,
        } satisfies SkillExecutorArgs,
      );

      return result;
    },
    {
      name: 'source_discover',
      description: `为目标问题发现并推荐权威外部参考信源（行业报告、榜单、协会、标准文档等）。
信源写入 source_decisions 表（status=adopted），供后续文章生成时引用。
前置条件：必须有选中（selected）的目标问题，否则返回明确错误。
返回 [{url, title, relevanceReason}] 数组。`,
      schema: sourceDiscoverInputSchema,
    },
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────────

/**
 * 创建 FactAgent SubAgent spec。
 *
 * 返回 DeepAgents SubAgent 配置，供 createDeepAgent({subagents: [...]}) 使用。
 * CEO 通过内置 task(subagent_type="fact-agent", description="...") 工具派发。
 *
 * Feature flags:
 * - interruptOn: { question_generate: true, source_discover: true } — #79 HITL: 工具执行前需用户审批
 */
export function createFactAgent(): SubAgent {
  return {
    name: 'fact-agent',
    description:
      '问题池生成与信源发现子 agent。负责基于已确认企业事实生成目标问题池（含商业价值评分），并为选中问题发现权威参考信源。当用户要求"生成问题池""发现信源""question generate""source discover"时使用此 agent。',
    systemPrompt: loadFactSystemPrompt(),
    tools: [createQuestionGenerateTool(), createSourceDiscoverTool()],
    model: createAgentModel(),
    interruptOn: {
      question_generate: true,
      source_discover: true,
    },
  };
}
