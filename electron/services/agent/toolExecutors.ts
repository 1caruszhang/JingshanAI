/**
 * toolExecutors.ts
 *
 * 工具执行器注册表（#60）。把 executor 的副作用编排抽为模型可调工具，
 * 让基座模型在 SKILL.md 工作流指引下自主调用工具完成编排。
 *
 * 两类工具：
 *   - 全局工具（所有 md-driven skill 共用）：create_article_placeholder /
 *     finalize_article / parse_claims
 *   - ranking 专属工具：save_ranking_entries（声明在 ranking 的 tools.md）
 *
 * 工具执行器统一形状：(args, ctx) => Promise<ToolResult>。
 * `ctx` 注入 DB 依赖（articleRepository 的函数），便于在 node:test 下用 mock
 * 替身跑全链路集成测试，无需 SQLite/Electron。
 *
 * 风险 gating：toolGuard 的 executeWithGuard 可包装每个执行器（复用 risk gating
 * + ledger）。当前注册表直接执行；接线 runtime 时由 toolCallLoop 经 guard 分派。
 *
 * 暂不接线 runtime——接线在 cutover 票 #62。
 */
import type {
  ArticleStrategy,
} from '../article/articleTypes.ts';
import type {
  AgentArtifact,
  ArticleArtifactMeta,
  ArticleClaim,
} from '@/types/domain';

/** 工具调用参数（来自模型 tool_call.args，已 JSON.parse）。 */
export type ToolArgs = Record<string, unknown>;

/** 工具执行结果。success 时 result 为可序列化值；failure 时 error 为信息。 */
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * 工具执行上下文：注入 articleRepository 的 DB 操作。
 * 生产环境由 runtime 注入真实实现；测试注入 mock。
 */
export interface ToolExecContext {
  createArticle: (input: {
    projectId: number;
    strategy: ArticleStrategy;
    supportArticleType?: string;
    targetQuestion: string;
    title: string;
    content: string;
    status?: string;
  }) => {artifact: AgentArtifact; meta: ArticleArtifactMeta};
  finalizeArticle: (artifactId: number, title: string, content: string) => void;
  createRankingArticleItems: (
    artifactId: number,
    projectId: number,
    entries: unknown[],
  ) => void;
  parseClaims: (artifactId: number) => Promise<unknown[]>;
}

/** 工具执行器签名。 */
export type ToolExecutor = (
  args: ToolArgs,
  ctx: ToolExecContext,
) => Promise<ToolResult>;

// ── 全局工具 ─────────────────────────────────────────────────────────────────

/**
 * 创建文章占位记录（status='generating'），返回 artifactId。
 * 模型在生成正文前调用，拿到 artifactId 后续 finalize。
 */
export const createArticlePlaceholder: ToolExecutor = async (args, ctx) => {
  const projectId = args.projectId as number;
  const strategy = args.strategy as ArticleStrategy;
  const targetQuestion = args.targetQuestion as string;
  const title = (args.title as string) ?? '生成中...';
  const supportArticleType = args.supportArticleType as string | undefined;

  if (!Number.isFinite(projectId) || !strategy || !targetQuestion) {
    return {success: false, error: 'create_article_placeholder 需要 projectId/strategy/targetQuestion'};
  }

  try {
    const {artifact} = ctx.createArticle({
      projectId,
      strategy,
      supportArticleType,
      targetQuestion,
      title,
      content: '',
      status: 'generating',
    });
    return {success: true, result: {artifactId: artifact.id}};
  } catch (err) {
    return {success: false, error: (err as Error).message};
  }
};

/**
 * 文章生成完成后写入最终标题与正文，status 改为 'draft'。
 */
export const finalizeArticle: ToolExecutor = async (args, ctx) => {
  const artifactId = args.artifactId as number;
  const title = args.title as string;
  const content = args.content as string;

  if (!Number.isFinite(artifactId) || !title || !content) {
    return {success: false, error: 'finalize_article 需要 artifactId/title/content'};
  }

  try {
    ctx.finalizeArticle(artifactId, title, content);
    return {success: true, result: {artifactId, status: 'draft'}};
  } catch (err) {
    return {success: false, error: (err as Error).message};
  }
};

/**
 * 对已 finalize 的文章抽取 Claim（断言），返回 claim 列表。
 */
export const parseClaimsTool: ToolExecutor = async (args, ctx) => {
  const artifactId = args.artifactId as number;
  if (!Number.isFinite(artifactId)) {
    return {success: false, error: 'parse_claims 需要 artifactId'};
  }

  try {
    const claims = await ctx.parseClaims(artifactId);
    return {success: true, result: {artifactId, claimsCount: claims.length}};
  } catch (err) {
    return {success: false, error: (err as Error).message};
  }
};

// ── ranking 专属工具 ─────────────────────────────────────────────────────────

/**
 * 保存排行榜条目到指定 artifact。ranking skill 专属，声明在 tools.md。
 */
export const saveRankingEntries: ToolExecutor = async (args, ctx) => {
  const artifactId = args.artifactId as number;
  const projectId = args.projectId as number;
  const entries = args.entries as unknown[];

  if (!Number.isFinite(artifactId) || !Number.isFinite(projectId) || !Array.isArray(entries)) {
    return {success: false, error: 'save_ranking_entries 需要 artifactId/projectId/entries'};
  }

  try {
    ctx.createRankingArticleItems(artifactId, projectId, entries);
    return {success: true, result: {artifactId, entriesCount: entries.length}};
  } catch (err) {
    return {success: false, error: (err as Error).message};
  }
};

/**
 * TOOL_EXECUTORS：工具名 → 执行器注册表。取代 SKILL_EXECUTORS 的工具分派职责。
 * toolCallLoop 按 tool_call.name 查表分派。
 */
export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  create_article_placeholder: createArticlePlaceholder,
  finalize_article: finalizeArticle,
  parse_claims: parseClaimsTool,
  save_ranking_entries: saveRankingEntries,
};

// ── 工具 JSON Schema 声明（注册到基座模型 API 的 tools 参数）──────────────────
//
// 全局工具 schema 在此声明；ranking 专属工具 schema 在 skills/ranking-article-generation/tools.md。
// 这些 schema 转换为模型 API 的 tools 参数（OpenAI function-calling 格式）。

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const GLOBAL_TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'create_article_placeholder',
      description: '创建文章占位记录（status=generating），返回 artifactId。在生成正文前调用。',
      parameters: {
        type: 'object',
        properties: {
          projectId: {type: 'number', description: '项目 ID'},
          strategy: {type: 'string', enum: ['support_article', 'ranking_article'], description: '文章策略'},
          targetQuestion: {type: 'string', description: '目标问题'},
          title: {type: 'string', description: '可选初始标题，默认"生成中..."'},
          supportArticleType: {type: 'string', description: '支持类文章子类型（strategy=support_article 时）'},
        },
        required: ['projectId', 'strategy', 'targetQuestion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_article',
      description: '文章生成完成后写入最终标题与正文，status 改为 draft。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {type: 'number', description: '文章 artifact ID'},
          title: {type: 'string', description: '最终标题'},
          content: {type: 'string', description: 'Markdown 格式的最终正文'},
        },
        required: ['artifactId', 'title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_claims',
      description: '对已 finalize 的文章抽取 Claim（断言），返回 claim 数量。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {type: 'number', description: '文章 artifact ID'},
        },
        required: ['artifactId'],
      },
    },
  },
];
