/**
 * knowledgeAgent.ts
 *
 * KnowledgeAgent 子 agent 工厂（#78）。
 *
 * 创建 DeepAgents SubAgent spec，供 CEO DeepAgent 的 task 工具派发。
 * KnowledgeAgent 持有 fact_extract 工具，负责从知识库抽取结构化企业事实。
 *
 * interruptOn: { fact_extract: true } — #79 HITL bridge PoC：
 *   fact_extract 执行前触发 interrupt，等待用户在 UI 审批。
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
  executeFactExtract,
  type SkillExecutorArgs,
} from './geoAgentFactory.ts';

// ── System prompt ────────────────────────────────────────────────────────────────

function loadKnowledgeSystemPrompt(): string {
  const soulAndRule = loadSoulAndRule();
  const agentPath = join(process.cwd(), 'agents', 'knowledge', 'AGENT.md');
  const raw = readFileSync(agentPath, 'utf8');
  const body = stripFrontmatter(raw);
  return `${soulAndRule}\n\n${body}`;
}

// ── fact_extract tool (LangChain wrapper) ────────────────────────────────────────

const factExtractInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  entryId: z.number().int().positive().optional().describe('可选：仅抽取指定 KB 条目'),
  chunkIds: z.array(z.number().int().positive()).optional().describe('可选：仅抽取指定 chunk IDs'),
});

/**
 * KnowledgeAgent 专用的 fact_extract LangChain 工具。
 *
 * 包装现有的 `executeFactExtract` 执行体，增加：
 * - 前置条件检查：无知识库条目时返回明确错误（非静默失败）
 * - 作为 SubAgent 工具（不含 toolGuard，interrupt 由 interruptOn 控制）
 */
function createFactExtractTool(): StructuredTool {
  return tool(
    async (input) => {
      // 前置条件门：检查知识库条目是否存在
      const db = getDb();
      const kbCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM knowledge_entries WHERE project_id = ?',
          )
          .get(input.projectId) as {count: number}
      ).count;

      if (kbCount === 0) {
        return JSON.stringify({
          error: 'precondition_failed',
          reason: '该项目尚无知识库条目。请先在知识库中上传企业资料（网页、文档等），然后再执行事实抽取。',
          suggestion: '前往「知识库管理」上传资料',
          factsExtracted: 0,
        });
      }

      // 调用现有的事实抽取执行体（复用 geoAgentFactory.ts 的核心逻辑）
      const result = await executeFactExtract(
        {
          projectId: input.projectId,
          entryId: input.entryId,
          chunkIds: input.chunkIds,
        } satisfies SkillExecutorArgs,
      );

      return result;
    },
    {
      name: 'fact_extract',
      description: `从项目知识库 chunks 中抽取结构化企业事实（写入 candidate facts，等待人工 review）。
根据项目 domain 选择对应的 ontology schema（SaaS/local_service/ecommerce 等）。
前置条件：项目必须至少有 1 条知识库条目，否则返回明确错误。
返回 {factsExtracted, candidates, domain, domainFactTypes}。`,
      schema: factExtractInputSchema,
    },
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────────

/**
 * 创建 KnowledgeAgent SubAgent spec。
 *
 * 返回 DeepAgents SubAgent 配置，供 createDeepAgent({subagents: [...]}) 使用。
 * CEO 通过内置 task(subagent_type="knowledge-agent", description="...") 工具派发。
 *
 * Feature flags:
 * - interruptOn: { fact_extract: true } — #79 HITL: fact_extract 前需用户审批
 */
export function createKnowledgeAgent(): SubAgent {
  return {
    name: 'knowledge-agent',
    description:
      '知识库管理与事实抽取子 agent。负责从已上传的企业资料中抽取结构化事实（公司全称、产品服务、核心优势等），写入 enterprise_facts 表供后续审核。当用户要求"抽取企业事实""fact extract"时使用此 agent。',
    systemPrompt: loadKnowledgeSystemPrompt(),
    tools: [createFactExtractTool()],
    model: createAgentModel(),
    interruptOn: {
      fact_extract: true,
    },
  };
}
