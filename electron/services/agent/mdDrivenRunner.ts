/**
 * mdDrivenRunner.ts
 *
 * md-driven skill execution path (#59). Runs a migrated skill end-to-end:
 *
 *   route 命中 kind='md-driven' + migrated=true 的 skill
 *     → 读 skillRegistry.getSkill(skillDir).frontmatter.needsKb
 *     → system = soul（身份）+ SKILL.md 正文
 *     → needsKb && projectId != null
 *         buildEvidencePack(projectId, 用户原始消息) → formatEvidence → user 段
 *       否则 user 段仅 taskText
 *     → user = [evidenceText, taskText].join('\n\n---\n\n')  (needsKb)
 *            或 taskText                                   (不需)
 *     → messages = [{system}, {user}] → chat(json_object)
 *     → index.ts validate(output)
 *     → ok → 采纳；not ok → errors 回灌 user message 重试，上限 2 次（共 3 次）
 *
 * 此模块是纯执行路径，依赖全部可注入（chatFn / buildEvidencePack / validateFn /
 * loadSkillBody / loadSoul），便于在 node:test 下用 mock 跑全链路集成测试，无需
 * Electron app 或 SQLite。
 *
 * 暂不接线 runtime——接线（路由命中 migrated skill 后调用 runMdDrivenSkill）在
 * #62 已将 runMdDrivenSkill 接入 runtime 主路径（md-driven migrated skill 分派）。
 * tool_call 循环（toolCallLoop）的接入在 #63。
 */
import {getSkill} from './skillRegistry.ts';
import {loadSoulAndRule} from '../../prompts/loader.ts';
import {
  buildEvidencePack as buildEvidencePackDefault,
  formatEvidence,
  type EvidencePack,
} from '../ragService.ts';
import {chat as chatDefault} from '../llmService.ts';
import type {ModelRole, ModelResponseFormat, UnifiedChatMessage} from '../models/types.ts';
import * as titleSkill from '../../../skills/title-generation/index.ts';
import * as rankingSkill from '../../../skills/ranking-article-generation/index.ts';
import {
  runToolCallLoop,
  type LoopMessage,
  type ModelFn,
  type ModelFnResult,
  type ToolCall,
  type ToolExecutorMap,
} from './toolCallLoop.ts';
import {
  GLOBAL_TOOL_SCHEMAS,
  TOOL_EXECUTORS,
  type ToolExecContext,
  type ToolResult,
} from './toolExecutors.ts';
import * as articleRepository from '../article/articleRepository.ts';
import {parseClaims as parseClaimsDefault} from '../article/claimParsingService.ts';

/** skill 目录名 → 对应 ModelRole（chat 第一参数，决定模型路由）。 */
const SKILL_DIR_TO_ROLE: Record<string, ModelRole> = {
  'title-generation': 'title_generation',
  'ranking-article-generation': 'ranking_article_generation',
};

/**
 * 各 skill 的 validate 函数统一形状。不同 skill 的 ValidationResult 内层 data
 * 类型不同，这里用泛型 data 占位；运行时只关心 ok / errors。
 */
type ValidateFn = (
  rawOutput: string | unknown,
  ctx?: unknown,
) => Promise<{ok: true; data: unknown} | {ok: false; errors: string[]}>;

/** skill 目录名 → validate 函数（来自各 skill 的 index.ts）。 */
const SKILL_DIR_TO_VALIDATE: Record<string, ValidateFn> = {
  'title-generation': titleSkill.validate as ValidateFn,
  'ranking-article-generation': rankingSkill.validate as ValidateFn,
};

/**
 * skill 目录名 → 专属工具 schema（声明在 skills/<name>/tools.md，转为 ToolSchema）。
 * 全局工具（create_article_placeholder / finalize_article / parse_claims）对所有
 * skill 共用，自动从 GLOBAL_TOOL_SCHEMAS 合入，不在此重复。无工具的 skill（如
 * title-generation）不在表中 → 走原单次生成路径。
 *
 * 接线说明：当前只有 ranking-article-generation 暴露专属工具 save_ranking_entries
 * （其 schema 见 skills/ranking-article-generation/tools.md）。完整 tools.md 解析
 * 留待后续；此处内联以保持最小改动。
 */
const RANKING_TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'save_ranking_entries',
      description:
        '保存排行榜条目到指定 artifact。每条 entry 含 company/position/reasons/sourceFactIds/reasoning_text。position 必须在 2-5 之间（目标企业不得排第 1）。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: {type: 'number', description: '文章 artifact ID（来自 create_article_placeholder 的返回）'},
          projectId: {type: 'number', description: '项目 ID'},
          entries: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              properties: {
                company: {type: 'string', description: '企业名称'},
                position: {type: 'integer', minimum: 1, description: '排名位置（目标企业须在 2-5）'},
                reasons: {type: 'array', items: {type: 'string'}, minItems: 1, description: '入选理由'},
                sourceFactIds: {type: 'array', items: {type: 'integer'}, description: '依据的 fact ID 列表'},
                reasoning_text: {type: 'string', description: '综合评语'},
              },
              required: ['company', 'position', 'reasons', 'sourceFactIds', 'reasoning_text'],
            },
          },
        },
        required: ['artifactId', 'projectId', 'entries'],
      },
    },
  },
];

const SKILL_DIR_TOOLS: Record<string, unknown[]> = {
  'ranking-article-generation': [...GLOBAL_TOOL_SCHEMAS, ...RANKING_TOOL_SCHEMAS],
};

/**
 * 把 DeepSeek 返回的 tool_calls（OpenAI function-calling 格式：
 * [{id, type:'function', function:{name, arguments:'<json string>'}}]）
 * 转为 runToolCallLoop 的 ToolCall[]。无法解析的 call 被跳过并告警。
 */
function toLoopToolCalls(rawToolCalls: unknown[] | undefined): ToolCall[] {
  if (!Array.isArray(rawToolCalls)) return [];
  const calls: ToolCall[] = [];
  for (const raw of rawToolCalls) {
    if (typeof raw !== 'object' || raw == null) continue;
    const r = raw as Record<string, unknown>;
    const fn = r.function as Record<string, unknown> | undefined;
    const id = typeof r.id === 'string' ? r.id : `call_${calls.length}`;
    const name = typeof fn?.name === 'string' ? fn.name : '';
    if (!name) continue;
    let args: Record<string, unknown> = {};
    const argRaw = fn?.arguments;
    if (typeof argRaw === 'string') {
      try {
        args = JSON.parse(argRaw);
      } catch {
        args = {};
      }
    } else if (argRaw && typeof argRaw === 'object') {
      args = argRaw as Record<string, unknown>;
    }
    calls.push({id, name, args});
  }
  return calls;
}

/**
 * 构造默认 ToolExecContext（生产实现：articleRepository + claimParsingService）。
 * 注入到 runToolCallLoop 供 create_article_placeholder/finalize_article/
 * save_ranking_entries/parse_claims 工具调用。
 */
function buildDefaultExecutorContext(projectId?: number): ToolExecContext {
  return {
    createArticle: (input) =>
      articleRepository.createArticle({
        projectId: input.projectId,
        strategy: input.strategy,
        supportArticleType: input.supportArticleType,
        targetQuestion: input.targetQuestion,
        title: input.title,
        content: input.content,
        status: input.status,
      }),
    finalizeArticle: (artifactId, title, content) =>
      articleRepository.finalizeArticleAfterGeneration(artifactId, title, content),
    createRankingArticleItems: (artifactId, projId, entries) =>
      articleRepository.createRankingArticleItems(
        artifactId,
        typeof projId === 'number' ? projId : projectId ?? 0,
        entries as articleRepository.RankingEntryInput[],
      ),
    parseClaims: (artifactId) => parseClaimsDefault(artifactId) as Promise<unknown[]>,
  };
}

/**
 * #81: 默认工具执行包装器（toolGuard 退役后直接执行）。
 * 失败时包装为 ToolResult。
 */
function buildDefaultExecuteTool(
  _taskId?: number | null,
  _stepId?: number | null,
  _projectId?: number | null,
): Parameters<typeof runToolCallLoop>[0]['executeTool'] {
  return async (_name, executor, args, ctx) => {
    try {
      const result = await executor(args, ctx);
      return {success: true, result};
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {success: false, error: message};
    }
  };
}

/** chat 函数注入形状：接收 messages + opts，返回 {content, model, toolCalls?}。 */
type ChatFn = (
  messages: UnifiedChatMessage[],
  opts: {
    responseFormat?: ModelResponseFormat;
    role?: ModelRole;
    /** tools 参数（OpenAI function-calling schema），传给底层 chat API。 */
    tools?: unknown[];
  },
) => Promise<{content: string; model: string; toolCalls?: unknown[]}>;

/** buildEvidencePack 注入形状。 */
type BuildEvidencePackFn = (
  projectId: number,
  query: string,
  topK?: number,
) => Promise<EvidencePack>;

/** 从任务参数文本化为 user 段的 taskText。 */
function formatTaskText(taskArgs: Record<string, unknown>): string {
  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`${label}：${value.join('、')}`);
      return;
    }
    if (typeof value === 'string' && value.trim() === '') return;
    lines.push(`${label}：${String(value)}`);
  };
  push('企业名称', taskArgs.projectName);
  push('目标问题', taskArgs.targetQuestion);
  push('竞品', taskArgs.competitors);
  push('文章标题', taskArgs.title);
  push('策略', taskArgs.strategy);
  // 兜底：把剩余未识别字段原样带上，避免丢信息
  const known = new Set([
    'projectName',
    'targetQuestion',
    'competitors',
    'title',
    'strategy',
    'projectId',
  ]);
  for (const [k, v] of Object.entries(taskArgs)) {
    if (known.has(k)) continue;
    push(k, v);
  }
  return lines.join('\n');
}

export interface MdDrivenRunOptions {
  projectId?: number;
  /** 任务参数（SkillExecutorArgs 文本化），如 projectName/targetQuestion/competitors。 */
  taskArgs: Record<string, unknown>;
  /** 用户原始消息，用作 buildEvidencePack 的 query。默认取 taskArgs.targetQuestion。 */
  userMessage?: string;
  /** 注入 chat（默认真实 chat）。 */
  chatFn?: ChatFn;
  /** 注入 buildEvidencePack（默认真实实现）。 */
  buildEvidencePack?: BuildEvidencePackFn;
  /** 注入 validate（默认按 skillDir 查表）。 */
  validateFn?: ValidateFn;
  /** 注入 SKILL.md 正文加载（默认 getSkill(skillDir).body）。 */
  loadSkillBody?: (skillDir: string) => string;
  /** 注入 soul 身份文本加载（默认 loadSoulAndRule()，含 soul + rule）。 */
  loadSoul?: () => string;
  // ── tool_call 循环接线（#63）─────────────────────────────────────────────
  /** 工具执行上下文（DB 依赖注入）。默认从 articleRepository/claimParsingService 构造。 */
  executorContext?: ToolExecContext;
  /** 工具执行器映射（默认 TOOL_EXECUTORS）。 */
  executors?: ToolExecutorMap;
  /**
   * 工具执行包装器（默认经 executeWithGuard 做 risk gating + ledger）。
   * 签名与 runToolCallLoop.executeTool 一致。测试可注入直调以跳过 guard。
   */
  executeTool?: (
    name: string,
    executor: (args: Record<string, unknown>, ctx: ToolExecContext) => Promise<ToolResult>,
    args: Record<string, unknown>,
    ctx: ToolExecContext,
  ) => Promise<ToolResult>;
  /** Agent task id（executeWithGuard ledger 用）。 */
  taskId?: number | null;
  /** Agent task step id（executeWithGuard ledger 用）。 */
  stepId?: number | null;
  /** 工具调用循环最大轮次，默认 runToolCallLoop 的 8。 */
  maxRounds?: number;
}

export type MdDrivenRunResult =
  | {ok: true; data: unknown}
  | {ok: false; errors: string[]};

/** 最大尝试次数：1 次初始 + 2 次重试。 */
const MAX_ATTEMPTS = 3;

/**
 * 执行一个 md-driven skill 的完整生成路径。
 *
 * 返回 {ok:true, data}（validate 通过，data 为校验后的结构化输出）或
 * {ok:false, errors}（重试上限后仍失败）。
 */
export async function runMdDrivenSkill(
  skillDir: string,
  opts: MdDrivenRunOptions,
): Promise<MdDrivenRunResult> {
  const loadSkillBody = opts.loadSkillBody ?? ((dir) => getSkill(dir)?.body ?? '');
  const loadSoul = opts.loadSoul ?? (() => loadSoulAndRule());
  const validateFn = opts.validateFn ?? SKILL_DIR_TO_VALIDATE[skillDir];
  const buildEvidencePack = opts.buildEvidencePack ?? buildEvidencePackDefault;
  const chatFn = opts.chatFn ??
    ((messages, chatOpts) =>
      chatDefault(chatOpts.role ?? 'chat', messages, {
        responseFormat: chatOpts.responseFormat,
        tools: chatOpts.tools,
      }));

  if (!validateFn) {
    return {ok: false, errors: [`skill "${skillDir}" 未注册 validate 函数`]};
  }

  const skill = getSkill(skillDir);
  const needsKb = skill?.frontmatter.needsKb === true;
  const role = SKILL_DIR_TO_ROLE[skillDir] ?? 'chat';

  // system = soul（身份）+ SKILL.md 正文（工作流/硬约束/输出格式等）
  const system = `${loadSoul()}\n\n${loadSkillBody(skillDir)}`.trim();

  const taskText = formatTaskText(opts.taskArgs);
  const query = opts.userMessage ?? (typeof opts.taskArgs.targetQuestion === 'string' ? opts.taskArgs.targetQuestion : '');

  // 声明式 KB 注入：needsKb && projectId != null
  let evidenceText = '';
  if (needsKb && typeof opts.projectId === 'number' && Number.isFinite(opts.projectId)) {
    const evidence = await buildEvidencePack(opts.projectId, query);
    evidenceText = formatEvidence(evidence);
  }

  const buildUserContent = (retryErrors?: string[]): string => {
    const parts: string[] = [];
    if (evidenceText) parts.push(evidenceText);
    parts.push(taskText);
    if (retryErrors && retryErrors.length > 0) {
      parts.push(
        `上次输出未通过校验，错误如下：\n${retryErrors.join('\n')}\n请修正后重新输出符合格式的 JSON。`,
      );
    }
    return parts.join('\n\n---\n\n');
  };

  // ── tool_call 循环接线（#63）───────────────────────────────────────────────
  // skill 有专属/全局工具 → 走 runToolCallLoop（模型发起 tool_call，执行器副作用
  // 创建 artifact / finalize / save entries / parse claims，最终输出交 validate）；
  // 无工具的 skill（title-generation）→ 原单次生成路径。
  const skillTools = SKILL_DIR_TOOLS[skillDir];
  const hasTools = Array.isArray(skillTools) && skillTools.length > 0;

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const initialMessages: UnifiedChatMessage[] = [
      {role: 'system', content: system},
      {
        role: 'user',
        content: buildUserContent(attempt > 1 ? lastErrors : undefined),
      },
    ];

    let content: string;
    try {
      if (hasTools) {
        content = await runToolLoopGenerate({
          chatFn,
          role,
          tools: skillTools,
          executors: opts.executors ?? TOOL_EXECUTORS,
          executorContext:
            opts.executorContext ?? buildDefaultExecutorContext(opts.projectId),
          executeTool:
            opts.executeTool ??
            buildDefaultExecuteTool(opts.taskId, opts.stepId, opts.projectId),
          initialMessages,
          maxRounds: opts.maxRounds,
        });
      } else {
        const resp = await chatFn(initialMessages, {responseFormat: 'json_object', role});
        content = resp.content;
      }
    } catch (err) {
      lastErrors = [`chat 调用失败：${(err as Error).message}`];
      if (attempt >= MAX_ATTEMPTS) {
        return {ok: false, errors: lastErrors};
      }
      continue;
    }

    const result = await validateFn(content, {input: opts.taskArgs});
    if (result.ok === true) {
      return {ok: true, data: result.data};
    }
    lastErrors = result.errors;
  }

  return {ok: false, errors: lastErrors};
}

/**
 * tool_call 循环生成路径（#63）。
 *
 * 把 chatFn 包装为 runToolCallLoop 的 modelFn：每轮把当前 messages（含 tool 回灌）
 * 经 chatFn（带 tools）调底层 chat，模型返回 content 或 tool_calls。tool_calls
 * 转 ToolCall[] 后交循环执行；无 tool_call 时返回 content 作最终输出。
 *
 * 循环失败（异常/上限）抛出，由外层 attempt 重试。
 */
async function runToolLoopGenerate(args: {
  chatFn: ChatFn;
  role: ModelRole;
  tools: unknown[];
  executors: ToolExecutorMap;
  executorContext: ToolExecContext;
  executeTool: NonNullable<Parameters<typeof runToolCallLoop>[0]['executeTool']>;
  initialMessages: UnifiedChatMessage[];
  maxRounds?: number;
}): Promise<string> {
  const {chatFn, role, tools, executors, executorContext, executeTool, initialMessages} = args;

  const modelFn: ModelFn = async (loopMessages: LoopMessage[]) => {
    // LoopMessage → UnifiedChatMessage（chat API 接受的形状）
    const messages: UnifiedChatMessage[] = loopMessages.map((m) => {
      const out: UnifiedChatMessage = {role: m.role, content: m.content};
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      return out;
    });
    const resp = await chatFn(messages, {responseFormat: 'json_object', role, tools});
    const toolCalls = toLoopToolCalls(resp.toolCalls);
    const result: ModelFnResult = {};
    if (resp.content) result.content = resp.content;
    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    return result;
  };

  const loopResult = await runToolCallLoop({
    modelFn,
    executors,
    executorContext,
    executeTool,
    initialMessages: initialMessages as LoopMessage[],
    maxRounds: args.maxRounds,
  });

  if (!loopResult.ok) {
    const failed = loopResult as {ok: false; error?: string; errors?: string[]};
    const detail = failed.error ?? (failed.errors ?? []).join('; ');
    throw new Error(`tool_call 循环失败：${detail}`);
  }
  return loopResult.content;
}
