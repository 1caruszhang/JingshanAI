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
 * cutover 票 #62。当前 runMdDrivenSkill 独立存在、可导出、可单测。
 */
import {getSkill} from './skillRegistry.ts';
import {loadPrompt} from '../../prompts/loader.ts';
import {
  buildEvidencePack as buildEvidencePackDefault,
  formatEvidence,
  type EvidencePack,
} from '../ragService.ts';
import {chat as chatDefault} from '../llmService.ts';
import type {ModelRole, ModelResponseFormat, UnifiedChatMessage} from '../models/types.ts';
import * as titleSkill from '../../../skills/title-generation/index.ts';
import * as rankingSkill from '../../../skills/ranking-article-generation/index.ts';

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

/** chat 函数注入形状：接收 messages + opts，返回 {content, model}。 */
type ChatFn = (
  messages: UnifiedChatMessage[],
  opts: {responseFormat?: ModelResponseFormat; role?: ModelRole},
) => Promise<{content: string; model: string}>;

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
  /** 注入 soul 身份文本加载（默认 loadPrompt('soul')）。 */
  loadSoul?: () => string;
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
  const loadSoul = opts.loadSoul ?? (() => loadPrompt('soul'));
  const validateFn = opts.validateFn ?? SKILL_DIR_TO_VALIDATE[skillDir];
  const buildEvidencePack = opts.buildEvidencePack ?? buildEvidencePackDefault;
  const chatFn = opts.chatFn ?? ((messages, chatOpts) => chatDefault(chatOpts.role ?? 'chat', messages, {responseFormat: chatOpts.responseFormat}));

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

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages: UnifiedChatMessage[] = [
      {role: 'system', content: system},
      {
        role: 'user',
        content: buildUserContent(attempt > 1 ? lastErrors : undefined),
      },
    ];

    let content: string;
    try {
      const resp = await chatFn(messages, {responseFormat: 'json_object', role});
      content = resp.content;
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
