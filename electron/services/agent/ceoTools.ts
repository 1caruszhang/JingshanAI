/**
 * ceoTools.ts
 *
 * CEO Agent 专用 LangChain 工具集（#76）。
 *
 * 6 个只读查询/路由工具，全部通过 LangChain `tool()` 注册，供 CEO DeepAgent 使用。
 * CEO 不持有任何 skill 执行工具（fact_extract、article_generate 等）——
 * 这些一律在 #78+ 通过子 agent 派发。
 */

import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {getDb} from '../../db/connection.ts';
import {route} from './intentRouter.ts';
import type {RouteResult} from './intentRouter.ts';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const intentRouterInputSchema = z.object({
  userMessage: z.string().min(1).describe('用户原始消息'),
  projectId: z.number().int().positive().optional().describe('当前项目 ID'),
  projectDomain: z.string().optional().describe('当前项目 domain（如 saas、local_service、ecommerce）'),
});

const projectDetailInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
});

const factListInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  status: z.enum(['confirmed', 'candidate', 'rejected']).optional().describe('筛选状态'),
  limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 50'),
});

const articleListInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  status: z.enum(['draft', 'completed', 'published']).optional().describe('筛选状态'),
  limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 50'),
});

const knowledgeListInputSchema = z.object({
  projectId: z.number().int().positive().describe('项目 ID'),
  limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 50'),
});

const taskHistoryInputSchema = z.object({
  projectId: z.number().int().positive().optional().describe('项目 ID（不传则查全部）'),
  limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
});

// ── Tool definitions ──────────────────────────────────────────────────────────

/**
 * `intent_router` 工具 — 封装 `intentRouter.route()` 为 LangChain tool。
 *
 * CEO 在收到用户消息后首先调用此工具，获取路由结果后决策：
 * - skill → "能力升级中"（#78+ 子 agent 上线后改派发）
 * - blocked → 告知用户原因
 * - clarify → 列出候选意图请用户确认
 * - fallback → 执行状态诊断
 */
export const intentRouterTool = tool(
  async ({userMessage, projectId, projectDomain}) => {
    const result: RouteResult = await route(userMessage, {
      projectId,
      projectDomain: projectDomain ?? null,
    });
    return JSON.stringify(result, null, 2);
  },
  {
    name: 'intent_router',
    description: `分析用户消息意图，映射到对应的 skill 或返回路由建议。

返回类型：
- skill: {type:"skill", skillName, kind, confidence, migrated} — 命中具体 skill
- blocked: {type:"blocked", skillName, reason} — 前置条件不满足
- clarify: {type:"clarify", candidates: [{intent, confidence}]} — 意图模糊
- fallback: {type:"fallback", mode:"status_diagnosis"} — 无匹配

内部使用短语匹配（快路径）+ 语义匹配（LLM）两级路由，precondition 门在路由层生效。`,
    schema: intentRouterInputSchema,
  },
);

/**
 * `project_detail` 工具 — 查看项目概览状态。
 *
 * 返回项目基本信息 + 统计（已确认/待确认事实数、文章数、知识条目数）+ 最近 5 个任务。
 * CEO 在 fallback 状态诊断或用户询问项目进展时使用。
 */
export const projectDetailTool = tool(
  async ({projectId}) => {
    const db = getDb();

    const project = db
      .prepare(
        `SELECT id, name, description, industry, region, domain, status, created_at, updated_at
         FROM projects WHERE id = ?`,
      )
      .get(projectId) as Record<string, unknown> | undefined;

    if (!project) {
      return JSON.stringify({error: `项目 ID ${projectId} 不存在`});
    }

    const confirmedFacts = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM enterprise_facts WHERE project_id = ? AND status = 'confirmed'`,
        )
        .get(projectId) as {count: number}
    ).count;

    const candidateFacts = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM enterprise_facts WHERE project_id = ? AND status = 'candidate'`,
        )
        .get(projectId) as {count: number}
    ).count;

    const articleCount = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM agent_artifacts WHERE project_id = ? AND artifact_type != 'agent_response'`,
        )
        .get(projectId) as {count: number}
    ).count;

    const knowledgeCount = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM knowledge_entries WHERE project_id = ?`,
        )
        .get(projectId) as {count: number}
    ).count;

    const recentTasks = db
      .prepare(
        `SELECT id, title, status, user_goal, created_at, completed_at
         FROM agent_tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT 5`,
      )
      .all(projectId);

    return JSON.stringify(
      {
        project,
        stats: {
          confirmedFacts,
          candidateFacts,
          articleCount,
          knowledgeCount,
        },
        recentTasks,
      },
      null,
      2,
    );
  },
  {
    name: 'project_detail',
    description: `查看项目概览状态。返回项目基本信息、统计数据（已确认事实数、待确认事实数、文章数、知识条目数）和最近 5 个任务。用于 fallback 状态诊断或用户询问项目进展。`,
    schema: projectDetailInputSchema,
  },
);

/**
 * `fact_list` 工具 — 列出项目的事实条目。
 *
 * 支持按 status 筛选（confirmed / candidate / rejected），默认返回最近 50 条。
 */
export const factListTool = tool(
  async ({projectId, status, limit = 50}) => {
    const db = getDb();

    let sql = `SELECT id, fact_type, fact_key, fact_value, confidence, status, source_entry_id, created_at
               FROM enterprise_facts WHERE project_id = ?`;
    const params: (number | string)[] = [projectId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return JSON.stringify(rows, null, 2);
  },
  {
    name: 'fact_list',
    description: `列出项目的事实条目。可按状态筛选（confirmed=已确认, candidate=待确认, rejected=已拒绝），默认返回最近 50 条。用于用户询问"有多少条事实""查看已确认事实"等。`,
    schema: factListInputSchema,
  },
);

/**
 * `article_list` 工具 — 列出项目的文章/artifacts。
 *
 * 按状态筛选，默认返回最近 50 条。排除 agent_response 类型的 artifact。
 */
export const articleListTool = tool(
  async ({projectId, status, limit = 50}) => {
    const db = getDb();

    let sql = `SELECT id, title, artifact_type, status, created_at, updated_at
               FROM agent_artifacts WHERE project_id = ? AND artifact_type != 'agent_response'`;
    const params: (number | string)[] = [projectId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return JSON.stringify(rows, null, 2);
  },
  {
    name: 'article_list',
    description: `列出项目的文章/artifacts。可按状态筛选（draft=草稿, completed=已完成, published=已发布），默认返回最近 50 条。用于用户询问"生成了哪些文章""上次的文章在哪"等。`,
    schema: articleListInputSchema,
  },
);

/**
 * `knowledge_list` 工具 — 列出项目的知识库条目。
 *
 * 返回知识条目基本信息，默认最近 50 条。
 */
export const knowledgeListTool = tool(
  async ({projectId, limit = 50}) => {
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT id, title, source_type, source_file_path, status, created_at
         FROM knowledge_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit);

    return JSON.stringify(rows, null, 2);
  },
  {
    name: 'knowledge_list',
    description: `列出项目的知识库条目。返回条目 ID、标题、来源类型、状态和创建时间，默认最近 50 条。用于用户询问"上传了哪些资料""知识库有多少条目"等。`,
    schema: knowledgeListInputSchema,
  },
);

/**
 * `task_history` 工具 — 查看历史 agent 任务。
 *
 * 可按 projectId 筛选，默认返回最近 20 条。
 */
export const taskHistoryTool = tool(
  async ({projectId, limit = 20}) => {
    const db = getDb();

    let sql = `SELECT id, title, status, user_goal, risk_level, created_at, completed_at
               FROM agent_tasks`;
    const params: (number | string)[] = [];

    if (projectId) {
      sql += ' WHERE project_id = ?';
      params.push(projectId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return JSON.stringify(rows, null, 2);
  },
  {
    name: 'task_history',
    description: `查看历史 agent 任务。可按项目 ID 筛选，默认返回最近 20 条。用于用户询问"之前做过哪些操作"或 fallback 时参考历史。`,
    schema: taskHistoryInputSchema,
  },
);
