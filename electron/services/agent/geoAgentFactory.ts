import {tool} from '@langchain/core/tools';
import {createDeepAgent} from 'deepagents';
import {z} from 'zod';
import type {DeepAgent} from 'deepagents';
import {createAgentModel} from './geoAgentModel.ts';
import {searchSimilarChunks} from '../vectorStore.ts';
import {askQuestion} from '../ragService.ts';
import {embedText} from '../embedding.ts';
import {getDb} from '../../db/connection.ts';

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

function buildGlobalSystemPrompt(): string {
  return `你是 GEO Agent（企业生成式引擎优化助手）。当前用户**未选择任何项目**，你处于 Global Chat 模式。

你可以做的事情：
- 回答用户关于 GEO、AI 搜索、内容优化的一般性问题。
- 解释产品使用方法、功能概念。
- 帮助用户规划 GEO 项目流程、建议需要准备哪些资料。
- 调用 project_list 查看已有项目。
- 调用 project_create 创建新项目。

你**不能**做的事情：
- 不要调用 kb_search、fact.extract、article.generate 等需要 project_id 的项目级工具。
- 不要基于某个具体企业的知识库回答问题。
- 如果用户提出需要项目资料的任务（如“帮我写篇文章”“检索一下我们公司资料”），请引导用户选择已有项目或创建新项目。`;
}

function buildProjectSystemPrompt(projectId: number): string {
  return `你是 GEO Agent（企业生成式引擎优化助手）。当前已选择项目 ID = ${projectId}，你处于 Project-aware GEO Agent 模式。

可用工具：
- kb_search：在项目知识库中检索相关资料片段。
- answer_user：基于项目知识库直接回答用户问题。
- project_list：列出所有项目（如需切换项目）。
- project_create：创建新项目。

工作原则：
1. 如果用户的问题可以在企业知识库内回答，优先调用 answer_user。
2. 如果用户只需要查找资料或你不确定答案，先调用 kb_search。
3. 只使用工具返回的信息，不要编造。
4. 回答保持简洁、专业。`;
}

export function createGeoAgent(projectId?: number): DeepAgent {
  const model = createAgentModel();

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
          content:
            '你是 GEO Agent。当前未选择项目。请基于通用知识回答用户问题，不要引用具体企业知识库。回答简洁专业。',
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
      const projectId = Number(result.lastInsertRowid);
      return `已创建项目「${input.name}」，项目 ID 为 ${projectId}。创建完成后可以录入企业资料，然后基于知识库执行 GEO 任务。`;
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
  }

  return createDeepAgent({
    name: projectId ? 'geo-project-agent' : 'geo-global-agent',
    model,
    tools,
    systemPrompt: projectId ? buildProjectSystemPrompt(projectId) : buildGlobalSystemPrompt(),
    checkpointer: false,
  });
}
